// server.js (Final Updated Code)
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const { MongoClient, ObjectId } = require('mongodb');
const app = express();
const PORT = 3000;

// MongoDB Connection
const MONGODB_URI = 'mongodb+srv://krish1:krish123@cluster0.rxhaklh.mongodb.net/';
const DATABASE_NAME = 'exam_portal';
let db;

MongoClient.connect(MONGODB_URI, { useUnifiedTopology: true })
  .then(client => { db = client.db(DATABASE_NAME); })
  .catch(err => { console.error('MongoDB Connection Error:', err); process.exit(1); });

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', async (req, res) => {
  const { email, password, role } = req.body;
  if (!email || !password || !role) return res.status(400).send('<h3>Missing login credentials.</h3>');

  try {
    const user = await db.collection('users').findOne({ email, role });
    if (!user || user.password !== password)
      return res.send('<h3>Incorrect email, password, or role.</h3>');

    const resultExists = await db.collection('results').findOne({ email });
    if (resultExists) return res.send('<h3>You have already submitted the exam.</h3>');

    return res.send(`
      <script>
        sessionStorage.setItem('name', '${user.name}');
        sessionStorage.setItem('email', '${user.email}');
        sessionStorage.setItem('role', '${user.role}');
        window.location.href = '/dashboard';
      </script>
    `);
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).send('Server error');
  }
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/instruction.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'instruction.html'));
});

async function validateExamAccess(req, res, next) {
  const email = req.query.email;
  const examType = req.query.exam;

  if (!email || !examType) return res.status(403).send('<h3>Missing exam type or email.</h3>');

  try {
    const user = await db.collection('users').findOne({ email });
    if (!user) return res.status(403).send('<h3>User not found.</h3>');

    const session = await db.collection('exam_sessions').findOne({
      user_id: user._id,
      exam_type: examType,
      status: "started",
      camera_active: true
    });

    if (!session) return res.status(403).send('<h3>No active session found.</h3>');

    next();
  } catch (err) {
    console.error('Exam access validation error:', err);
    return res.status(500).send('<h3>Server error.</h3>');
  }
}

app.get('/vle_exam.html', validateExamAccess, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'vle_exam.html'));
});

app.get('/vlm_exam.html', validateExamAccess, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'vlm_exam.html'));
});

app.post('/api/start-exam', async (req, res) => {
  const { email, examType } = req.body;
  if (!email || !examType) return res.status(400).json({ error: 'Missing email or exam type' });

  try {
    const user = await db.collection('users').findOne({ email });
    if (!user) return res.status(404).json({ error: 'User not found' });

    await db.collection('exam_sessions').insertOne({
      user_id: user._id,
      exam_type: examType,
      status: "started",
      camera_active: true,
      started_at: new Date()
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Start exam error:', err);
    res.status(500).json({ error: 'Failed to start exam', details: err.message });
  }
});

// ✅ Updated: Submit Answers API with attempted flag
app.post('/api/submit-answers', async (req, res) => {
  const { email, examType, answers } = req.body;

  if (!email || !examType || !Array.isArray(answers) || answers.length === 0) {
    return res.status(400).json({ error: 'Invalid submission data' });
  }

  try {
    const questionIds = answers.map(a => new ObjectId(a.questionId));
    const questionsFromDb = await db.collection('questions').find({
      _id: { $in: questionIds }
    }).toArray();

    const questionMap = {};
    questionsFromDb.forEach(q => {
      questionMap[q._id.toString()] = q;
    });

    let correctCount = 0;
    const detailedAnswers = answers.map(a => {
      const q = questionMap[a.questionId];
      const selected = a.selectedOption;
      const correct = q.correct_option?.toString().trim();

      const isCorrect = selected && selected.startsWith(correct);
      if (isCorrect) correctCount++;

      return {
        question_id: a.questionId,
        question_text: q.text,
        options: q.options,
        selected_option: selected,
        correct_option: correct,
        attempted: selected !== null
      };
    });

    const totalQuestions = detailedAnswers.length;
    const marks = ((correctCount / totalQuestions) * 100).toFixed(2);

    const result = {
      email,
      exam_type: examType,
      submitted_at: new Date(),
      total_questions: totalQuestions,
      correct_answers: correctCount,
      marks_obtained: parseFloat(marks),
      answers: detailedAnswers
    };

    await db.collection('results').insertOne(result);

    const user = await db.collection('users').findOne({ email });
    await db.collection('exam_sessions').deleteMany({ user_id: user._id, exam_type: examType });

    res.json({ success: true });
  } catch (err) {
    console.error('Error submitting answers:', err);
    res.status(500).json({ error: 'Failed to submit answers' });
  }
});

app.get('/api/questions', async (req, res) => {
  const examType = req.query.exam;
  if (!examType) return res.status(400).json({ error: 'Missing exam type' });

  try {
    const questions = await db.collection('questions')
      .find({ exam_type: examType }).toArray();

    const parsed = questions.map(q => ({
      id: q._id.toString(),
      text: q.question || q.text,
      options: Object.entries(q.options || {}).map(([key, val]) => `${key}. ${val}`)
    }));

    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch questions', details: err.message });
  }
});

app.use((req, res) => {
  res.status(404).send('<h3>404 - Page Not Found</h3>');
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
