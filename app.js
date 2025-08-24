
const express = require('express');
const path = require('path');
const QRCode = require('qrcode');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize SQLite DB
const DB_FILE = path.join(__dirname, 'attendance.db');
const dbExists = fs.existsSync(DB_FILE);
const db = new sqlite3.Database(DB_FILE);

db.serialize(() => {
  if (!dbExists) {
    db.run(`CREATE TABLE students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      roll TEXT UNIQUE,
      name TEXT
    )`);
    db.run(`CREATE TABLE attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER,
      timestamp TEXT,
      date TEXT,
      FOREIGN KEY(student_id) REFERENCES students(id)
    )`);
  }
});

// Routes
app.get('/', (req, res) => {
  res.redirect('/students');
});

// List students
app.get('/students', (req, res) => {
  db.all("SELECT * FROM students ORDER BY roll", (err, rows) => {
    if (err) return res.send('DB error');
    res.render('students', { students: rows });
  });
});

// Add student form
app.get('/students/new', (req, res) => {
  res.render('student_new');
});

// Create student and generate QR
app.post('/students', (req, res) => {
  const { roll, name } = req.body;
  if (!roll || !name) return res.send('roll and name required');
  db.run("INSERT OR IGNORE INTO students(roll,name) VALUES(?,?)", [roll, name], function(err) {
    if (err) return res.send('DB insert error: ' + err.message);
    // ensure inserted or get existing student id
    db.get("SELECT * FROM students WHERE roll = ?", [roll], (err, student) => {
      if (err || !student) return res.send('DB select error');
      // generate QR PNG with roll embedded
      const qrPath = path.join('public','qrs', roll + '.png');
      const qrFull = path.join(__dirname, qrPath);
      QRCode.toFile(qrFull, roll, { width: 300 }, function (err) {
        if (err) console.error('QR gen error', err);
        res.redirect('/students/' + student.id + '/qr');
      });
    });
  });
});

// View student QR
app.get('/students/:id/qr', (req, res) => {
  const id = req.params.id;
  db.get("SELECT * FROM students WHERE id = ?", [id], (err, student) => {
    if (err || !student) return res.send('Student not found');
    res.render('student_qr', { student });
  });
});

// Scanner page (webcam)
app.get('/scan', (req, res) => {
  res.render('scan');
});

// API to mark attendance (called from scanner JS)
app.post('/api/mark', (req, res) => {
  const roll = (req.body.roll || '').trim();
  if (!roll) return res.status(400).json({ ok: false, error: 'roll required' });
  db.get("SELECT * FROM students WHERE roll = ?", [roll], (err, student) => {
    if (err) return res.status(500).json({ ok: false, error: 'db error' });
    if (!student) return res.status(404).json({ ok: false, error: 'student not found' });
    const now = new Date();
    const timestamp = now.toISOString();
    const date = now.toISOString().slice(0,10);
    db.run("INSERT INTO attendance(student_id,timestamp,date) VALUES(?,?,?)", [student.id, timestamp, date], function(err) {
      if (err) return res.status(500).json({ ok: false, error: 'insert error' });
      return res.json({ ok: true, student: { name: student.name, roll: student.roll }, timestamp });
    });
  });
});

// Attendance report
app.get('/attendance', (req, res) => {
  db.all(`SELECT a.id, s.roll, s.name, a.timestamp, a.date 
          FROM attendance a JOIN students s ON a.student_id = s.id
          ORDER BY a.timestamp DESC LIMIT 200`, (err, rows) => {
    if (err) return res.send('DB error');
    res.render('attendance', { records: rows });
  });
});

// Export CSV
app.get('/export.csv', (req, res) => {
  db.all(`SELECT a.id, s.roll, s.name, a.timestamp, a.date 
          FROM attendance a JOIN students s ON a.student_id = s.id
          ORDER BY a.timestamp DESC`, (err, rows) => {
    if (err) return res.send('DB error');
    let csv = 'id,roll,name,timestamp,date\n';
    rows.forEach(r => {
      csv += `${r.id},${r.roll},"${r.name}",${r.timestamp},${r.date}\n`;
    });
    res.header('Content-Type','text/csv');
    res.attachment('attendance_export.csv');
    res.send(csv);
  });
});



// Edit student name
app.post('/students/:roll/edit', (req, res) => {
  const roll = req.params.roll;
  const name = req.body.name;
  db.run("UPDATE students SET name=? WHERE roll=?", [name, roll], function(err){
    if(err) return res.send('Update error: '+err.message);
    // Regenerate QR
    const QRCode = require('qrcode');
    QRCode.toFile(`public/qrs/${roll}.png`, roll, { width: 300 }, (err)=>{if(err)console.error(err)});
    res.redirect('/students');
  });
});

// Delete student
app.get('/students/:roll/delete', (req,res)=>{
  const roll = req.params.roll;
  db.run("DELETE FROM students WHERE roll=?", [roll], function(err){
    if(err) return res.send('Delete error: '+err.message);
    res.redirect('/students');
  });
});


app.listen(PORT, () => {
  console.log('Server listening on port', PORT);
});
