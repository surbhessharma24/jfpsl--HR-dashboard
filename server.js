const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const DASHBOARD_PASSWORD = process.env.PASSWORD || 'admin123';

if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = /pdf|doc|docx|txt/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only PDF, DOC, DOCX files are allowed'));
    }
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.set('view engine', 'ejs');
app.set('views', 'views');

app.use(session({
  secret: 'hr-dashboard-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

const db = new sqlite3.Database('hr_dashboard.db', (err) => {
  if (err) {
    console.error('Database error:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

function initializeDatabase() {
  db.run(`CREATE TABLE IF NOT EXISTS candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    position TEXT,
    status TEXT DEFAULT 'Applied',
    resume_file TEXT,
    applied_date TEXT DEFAULT CURRENT_TIMESTAMP,
    notes TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS interviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id INTEGER,
    interview_date TEXT,
    interview_type TEXT,
    interviewer TEXT,
    rating INTEGER,
    feedback TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(candidate_id) REFERENCES candidates(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS onboarding (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id INTEGER,
    task TEXT,
    status TEXT DEFAULT 'Pending',
    assigned_to TEXT,
    due_date TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(candidate_id) REFERENCES candidates(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id INTEGER,
    action_type TEXT,
    description TEXT,
    performed_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(candidate_id) REFERENCES candidates(id)
  )`);
}

function isAuthenticated(req, res, next) {
  if (req.session.authenticated) {
    next();
  } else {
    res.redirect('/login');
  }
}

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === DASHBOARD_PASSWORD) {
    req.session.authenticated = true;
    res.redirect('/dashboard');
  } else {
    res.render('login', { error: 'Invalid password' });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

app.get('/dashboard', isAuthenticated, (req, res) => {
  db.all('SELECT * FROM candidates ORDER BY applied_date DESC', (err, candidates) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.render('dashboard', { candidates });
  });
});

app.get('/candidate/:id', isAuthenticated, (req, res) => {
  const { id } = req.params;
  
  db.get('SELECT * FROM candidates WHERE id = ?', [id], (err, candidate) => {
    if (err || !candidate) {
      return res.status(404).render('404');
    }
    
    db.all('SELECT * FROM interviews WHERE candidate_id = ? ORDER BY interview_date DESC', [id], (err, interviews) => {
      db.all('SELECT * FROM onboarding WHERE candidate_id = ?', [id], (err, onboarding) => {
        db.all('SELECT * FROM actions WHERE candidate_id = ? ORDER BY created_at DESC', [id], (err, actions) => {
          res.render('candidate-detail', { candidate, interviews, onboarding, actions });
        });
      });
    });
  });
});

app.post('/candidate/add', isAuthenticated, upload.single('resume'), (req, res) => {
  const { name, email, phone, position, notes } = req.body;
  const resume_file = req.file ? req.file.filename : null;

  db.run(
    'INSERT INTO candidates (name, email, phone, position, resume_file, notes) VALUES (?, ?, ?, ?, ?, ?)',
    [name, email, phone, position, resume_file, notes],
    (err) => {
      if (err) {
        return res.status(400).json({ error: err.message });
      }
      res.json({ success: true, message: 'Candidate added successfully' });
    }
  );
});

app.post('/candidate/:id/status', isAuthenticated, (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  db.run('UPDATE candidates SET status = ? WHERE id = ?', [status, id], (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    db.run('INSERT INTO actions (candidate_id, action_type, description, performed_by) VALUES (?, ?, ?, ?)',
      [id, 'Status Change', `Status changed to ${status}`, 'User'],
      () => {
        res.json({ success: true, message: 'Status updated' });
      }
    );
  });
});

app.post('/candidate/:id/notes', isAuthenticated, (req, res) => {
  const { id } = req.params;
  const { notes } = req.body;

  db.run('UPDATE candidates SET notes = ? WHERE id = ?', [notes, id], (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    res.json({ success: true, message: 'Notes updated' });
  });
});

app.post('/interview/add', isAuthenticated, (req, res) => {
  const { candidate_id, interview_date, interview_type, interviewer, rating, feedback } = req.body;

  db.run(
    'INSERT INTO interviews (candidate_id, interview_date, interview_type, interviewer, rating, feedback) VALUES (?, ?, ?, ?, ?, ?)',
    [candidate_id, interview_date, interview_type, interviewer, rating, feedback],
    (err) => {
      if (err) {
        return res.status(400).json({ error: err.message });
      }
      db.run('INSERT INTO actions (candidate_id, action_type, description, performed_by) VALUES (?, ?, ?, ?)',
        [candidate_id, 'Interview', `${interview_type} interview scheduled with ${interviewer}`, 'User'],
        () => {
          res.json({ success: true, message: 'Interview added successfully' });
        }
      );
    }
  );
});

app.post('/onboarding/add', isAuthenticated, (req, res) => {
  const { candidate_id, task, assigned_to, due_date } = req.body;

  db.run(
    'INSERT INTO onboarding (candidate_id, task, assigned_to, due_date) VALUES (?, ?, ?, ?)',
    [candidate_id, task, assigned_to, due_date],
    (err) => {
      if (err) {
        return res.status(400).json({ error: err.message });
      }
      res.json({ success: true, message: 'Onboarding task added' });
    }
  );
});

app.post('/onboarding/:id/status', isAuthenticated, (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  db.run('UPDATE onboarding SET status = ? WHERE id = ?', [status, id], (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    res.json({ success: true, message: 'Task status updated' });
  });
});

app.post('/action/add', isAuthenticated, (req, res) => {
  const { candidate_id, action_type, description } = req.body;

  db.run(
    'INSERT INTO actions (candidate_id, action_type, description, performed_by) VALUES (?, ?, ?, ?)',
    [candidate_id, action_type, description, 'User'],
    (err) => {
      if (err) {
        return res.status(400).json({ error: err.message });
      }
      res.json({ success: true, message: 'Action logged' });
    }
  );
});

app.get('/download-resume/:filename', isAuthenticated, (req, res) => {
  const file = path.join(__dirname, 'uploads', req.params.filename);
  res.download(file);
});

app.get('/', (req, res) => {
  if (req.session.authenticated) {
    res.redirect('/dashboard');
  } else {
    res.redirect('/login');
  }
});

app.listen(PORT, () => {
  console.log(`HR Dashboard running on http://localhost:${PORT}`);
});
