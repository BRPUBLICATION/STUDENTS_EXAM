const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const mysql = require('mysql2');
const app = express();
const PORT = 3000;

// MySQL Connection
const db = mysql.createConnection({
  host: '127.0.0.1',
  user: 'root',
  password: 'Krish@2005', // Use environment variables in production
  database: 'exam_portal',
});

db.connect(err => {
  if (err) {
    console.error('❌ MySQL Connection Error:', err);
    process.exit(1);
  }
  console.log('✅ Connected to MySQL Database.');
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
app.post('/login', (req, res) => {
  const { email, password, role } = req.body;
  if (!email || !password || !role) {
    return res.status(400).send('<h3>❌ Missing login credentials.</h3>');
  }
  const sql = 'SELECT * FROM users WHERE email = ? AND role = ?';
  db.query(sql, [email, role], (err, results) => {
    if (err) return res.status(500).send('Server error');
    if (results.length > 0 && results[0].password === password) {
      const user = results[0];
      console.log(`✅ ${user.name} (${user.email}) logged in as ${user.role}`);
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
  });
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
function validateExamAccess(req, res, next) {
  const email = req.query.email;
  const examType = req.query.exam;
  if (!email || !examType) {
    return res.status(403).send('<h3>❌ Missing exam type or email. Start the exam from the instruction page.</h3>');
  }
  const sql = 'SELECT * FROM exam_sessions WHERE user_id = (SELECT id FROM users WHERE email = ?) AND exam_type = ? AND status = "started" AND camera_active = TRUE';
  db.query(sql, [email, examType], (err, results) => {
    if (err) return res.status(500).send('<h3>❌ Server error. Please try again.</h3>');
    if (results.length === 0) return res.status(403).send('<h3>❌ No active session. Start the exam from the instruction page with camera enabled.</h3>');
    next();
  });
}

// Exam Pages
app.get('/vle_exam.html', validateExamAccess, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'vle_exam.html'));
});

app.get('/vlm_exam.html', validateExamAccess, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'vlm_exam.html'));
});

// Start Exam API
app.post('/api/start-exam', (req, res) => {
  const { email, examType } = req.body;
  if (!email || !examType) {
    return res.status(400).json({ error: 'Missing email or exam type' });
  }
  const sql = 'INSERT INTO exam_sessions (user_id, exam_type, status, camera_active, started_at) VALUES ((SELECT id FROM users WHERE email = ?), ?, "started", TRUE, NOW())';
  db.query(sql, [email, examType], (err) => {
    if (err) return res.status(500).json({ error: 'Failed to start exam', details: err.message });
    console.log(`📌 Exam session started: ${email} for ${examType}`);
    res.json({ success: true });
  });
});

// Submit Answers API
app.post('/api/submit-answers', (req, res) => {
  const { email, examType, answers } = req.body;
  if (!email || !examType || !Array.isArray(answers) || answers.length === 0 || !answers.every(a => a.questionId && a.selectedOption)) {
    return res.status(400).json({ error: 'Invalid submission data' });
  }

  const insertResponses = 'INSERT INTO responses (email, exam_type, question_id, selected_option) VALUES ?';
  const responseValues = answers.map(a => [email, examType, parseInt(a.questionId), a.selectedOption]);

  db.query(insertResponses, [responseValues], (err) => {
    if (err) {
      console.error('❌ Failed to save answers:', err);
      return res.status(500).json({ error: 'Failed to save answers', details: err.message });
    }

    const questionIds = answers.map(a => parseInt(a.questionId));
    const fetchCorrectSQL = `SELECT id, correct_answer FROM questions WHERE id IN (?)`;

    db.query(fetchCorrectSQL, [questionIds], (err, correctRows) => {
      if (err) {
        console.error('❌ Failed to fetch correct answers:', err);
        return res.status(500).json({ error: 'Failed to fetch correct answers', details: err.message });
      }

      const correctMap = {};
      correctRows.forEach(q => correctMap[q.id] = q.correct_answer);

      let correctCount = 0;
      console.log(`📝 Answers:`);

      answers.forEach(a => {
        const qid = parseInt(a.questionId);
        const selected = a.selectedOption;
        const correct = correctMap[qid];
        const isCorrect = selected === correct;
        if (isCorrect) correctCount++;
        console.log(`Q${qid} (ID: ${qid}): Selected -> ${selected}`);
      });

      const totalQuestions = answers.length;
      const score = ((correctCount / totalQuestions) * 100).toFixed(2);

      const insertResultSQL = `INSERT INTO results (email, exam_type, total_questions, correct_answers, marks_obtained) VALUES (?, ?, ?, ?, ?)`;
      db.query(insertResultSQL, [email, examType, totalQuestions, correctCount, score], (err) => {
        if (err) {
          console.error('❌ Failed to save result:', err);
          return res.status(500).json({ error: 'Failed to save result', details: err.message });
        }

        console.log(`📊 ${email} completed ${examType} | Correct: ${correctCount}/${totalQuestions} | Score: ${score}%`);
        res.json({ success: true });
      });
    });
  });
});

// Fetch Questions API
app.get('/api/questions', (req, res) => {
  const examType = req.query.exam;
  if (!examType) return res.status(400).json({ error: 'Missing exam type' });
  const sql = 'SELECT * FROM questions WHERE exam_type = ? LIMIT 5';
  db.query(sql, [examType], (err, results) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch questions', details: err.message });
    const parsed = results.map(q => {
      let options = q.options;
      try {
        options = typeof options === 'string' ? JSON.parse(options) : options;
      } catch (e) {
        options = [];
      }
      return { id: q.id, text: q.text, options };
    });
    res.json(parsed);
  });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).send('<h3>404 - Page Not Found</h3>');
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚗 Server running at http://localhost:${PORT}`);
});