const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const { MongoClient, ObjectId } = require('mongodb');
const app = express();
const PORT = 3000;

// MongoDB Connection
const MONGODB_URI = 'mongodb+srv://krish1:krish123@cluster0.rxhaklh.mongodb.net/'; // Change this to your MongoDB URI
const DATABASE_NAME = 'exam_portal';
let db;

// Connect to MongoDB
MongoClient.connect(MONGODB_URI, { useUnifiedTopology: true })
  .then(client => {
    console.log('✅ Connected to MongoDB Database.');
    db = client.db(DATABASE_NAME);
  })
  .catch(err => {
    console.error('❌ MongoDB Connection Error:', err);
    process.exit(1);
  });

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Home Route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Login Handler
app.post('/login', async (req, res) => {
  const { email, password, role } = req.body;
  if (!email || !password || !role) {
    return res.status(400).send('<h3>❌ Missing login credentials.</h3>');
  }
  
  try {
    const user = await db.collection('users').findOne({ email, role });
    
    if (user && user.password === password) {
      //console.log(✅ ${user.name} (${user.email}) logged in as ${user.role});
      return res.send(`
        <script>
          sessionStorage.setItem('name', '${user.name}');
          sessionStorage.setItem('email', '${user.email}');
          sessionStorage.setItem('role', '${user.role}');
          window.location.href = '/dashboard';
        </script>
      `);
    }
    return res.send('<h3>❌ Incorrect email, password, or role.</h3>');
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).send('Server error');
  }
});

// Dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Instructions Page
app.get('/instruction.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'instruction.html'));
});

// Exam Access Validation Middleware
async function validateExamAccess(req, res, next) {
  const email = req.query.email;
  const examType = req.query.exam;
  
  if (!email || !examType) {
    return res.status(403).send('<h3>❌ Missing exam type or email. Start the exam from the instruction page.</h3>');
  }
  
  try {
    // First get the user
    const user = await db.collection('users').findOne({ email });
    if (!user) {
      return res.status(403).send('<h3>❌ User not found.</h3>');
    }
    
    // Check for active exam session
    const session = await db.collection('exam_sessions').findOne({
      user_id: user._id,
      exam_type: examType,
      status: "started",
      camera_active: true
    });
    
    if (!session) {
      return res.status(403).send('<h3>❌ No active session. Start the exam from the instruction page with camera enabled.</h3>');
    }
    
    next();
  } catch (err) {
    console.error('Exam access validation error:', err);
    return res.status(500).send('<h3>❌ Server error. Please try again.</h3>');
  }
}

// Exam Pages
app.get('/vle_exam.html', validateExamAccess, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'vle_exam.html'));
});

app.get('/vlm_exam.html', validateExamAccess, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'vlm_exam.html'));
});

// Start Exam API
app.post('/api/start-exam', async (req, res) => {
  const { email, examType } = req.body;
  if (!email || !examType) {
    return res.status(400).json({ error: 'Missing email or exam type' });
  }
  
  try {
    // Get user first
    const user = await db.collection('users').findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Insert exam session
    const examSession = {
      user_id: user._id,
      exam_type: examType,
      status: "started",
      camera_active: true,
      started_at: new Date()
    };
    
    await db.collection('exam_sessions').insertOne(examSession);
    
    //console.log(📌 Exam session started: ${email} for ${examType});
    res.json({ success: true });
  } catch (err) {
    console.error('Start exam error:', err);
    return res.status(500).json({ error: 'Failed to start exam', details: err.message });
  }
});

// Submit Answers API
app.post('/api/submit-answers', async (req, res) => {
  const { email, examType, answers } = req.body;
  
  if (!email || !examType || !Array.isArray(answers) || answers.length === 0 || 
      !answers.every(a => a.questionId && a.selectedOption)) {
    return res.status(400).json({ error: 'Invalid submission data' });
  }

  try {
    // Prepare response documents
    const responseDocuments = answers.map(a => ({
      email,
      exam_type: examType,
      question_id: a.questionId,
      selected_option: a.selectedOption,
      submitted_at: new Date()
    }));

    // Insert all responses
    await db.collection('responses').insertMany(responseDocuments);

    // Get question IDs for fetching correct answers
    const questionIds = answers.map(a => a.questionId);
    
    // Fetch correct answers
    const questions = await db.collection('questions').find({
      _id: { $in: questionIds.map(id => new ObjectId(id)) }
    }).toArray();

    // Create a map of correct answers
    const correctMap = {};
    questions.forEach(q => correctMap[q._id.toString()] = q.correct_answer);

    let correctCount = 0;
    //console.log(📝 Answers:);

    answers.forEach(a => {
      const qid = a.questionId;
      const selected = a.selectedOption;
      const correct = correctMap[qid];
      const isCorrect = selected === correct;
      if (isCorrect) correctCount++;
      //console.log(Q${qid}: Selected -> ${selected});
    });

    const totalQuestions = answers.length;
    const score = ((correctCount / totalQuestions) * 100).toFixed(2);

    // Insert result
    const result = {
      email,
      exam_type: examType,
      total_questions: totalQuestions,
      correct_answers: correctCount,
      marks_obtained: parseFloat(score),
      submitted_at: new Date()
    };

    await db.collection('results').insertOne(result);

    //console.log(📊 ${email} completed ${examType} | Correct: ${correctCount}/${totalQuestions} | Score: ${score}%);
    res.json({ success: true });
    
  } catch (err) {
    console.error('Submit answers error:', err);
    return res.status(500).json({ error: 'Failed to submit answers', details: err.message });
  }
});

// Fetch Questions API
app.get('/api/questions', async (req, res) => {
  const examType = req.query.exam;
  if (!examType) return res.status(400).json({ error: 'Missing exam type' });
  
  try {
    const questions = await db.collection('questions')
      .find({ exam_type: examType })
      .limit(5)
      .toArray();
    
    const parsed = questions.map(q => {
      let options = q.options || [];
      
      // Handle options if they're stored as string
      if (typeof options === 'string') {
        try {
          options = JSON.parse(options);
        } catch (e) {
          options = [];
        }
      }
      
      return { 
        id: q._id.toString(), 
        text: q.text, 
        options 
      };
    });
    
    res.json(parsed);
  } catch (err) {
    console.error('Fetch questions error:', err);
    return res.status(500).json({ error: 'Failed to fetch questions', details: err.message });
  }
});

// 404 Handler
app.use((req, res) => {
  res.status(404).send('<h3>404 - Page Not Found</h3>');
});

// Start Server
app.listen(PORT, () => {
  //console.log(🚗 Server running at http://localhost:${PORT});
});
