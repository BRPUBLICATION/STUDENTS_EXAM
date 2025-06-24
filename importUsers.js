const xlsx = require("xlsx");
const mysql = require("mysql2");
const { v4: uuidv4 } = require("uuid");

// Load Excel
const workbook = xlsx.readFile("student_passwords.xlsx"); // updated file name
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const data = xlsx.utils.sheet_to_json(sheet);

// Connect to DB
const db = mysql.createConnection({
  host: "127.0.0.1",
  user: "root",
  password: "Krish@2005",
  database: "exam_portal",
});

// Insert users
data.forEach((row) => {
  const email = row.Email?.toString().trim();
  const password = row.Password?.toString().trim();

  if (!email || !password) {
    console.log("⚠️ Skipping invalid row:", row);
    return;
  }

  const user = {
    id: uuidv4(),
    name: email.split("@")[0],
    role: "student",
    student_id: `S-${Math.floor(Math.random() * 10000)}`,
    email,
    password,
  };

  const sql = `
    INSERT INTO users (id, name, role, student_id, email, password)
    VALUES (?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE password = VALUES(password)
  `;

  db.query(
    sql,
    [user.id, user.name, user.role, user.student_id, user.email, user.password],
    (err) => {
      if (err) {
        console.error("❌ Error inserting:", email, err.message);
      } else {
        console.log(`✅ Inserted/Updated: ${email}`);
      }
    }
  );
});
