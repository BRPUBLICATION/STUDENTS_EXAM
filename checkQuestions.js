const mysql = require("mysql2");

const db = mysql.createConnection({
  host: "127.0.0.1",
  user: "root",
  password: "Krish@2005",
  database: "exam_portal",
});

db.query("SELECT * FROM questions LIMIT 5", (err, results) => {
  if (err) {
    console.error("❌ MySQL Error:", err);
  } else if (results.length === 0) {
    console.log("⚠️ No questions found in 'questions' table.");
  } else {
    console.log(`✅ Found ${results.length} questions.`);
    console.log(results);
  }
  db.end();
});
