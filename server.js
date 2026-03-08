const express = require("express");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// SQLite DB 초기화
const db = new Database(process.env.DB_PATH || "/data/sudoku.db");
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS progress (
    user_id INTEGER NOT NULL,
    puzzle_key TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, puzzle_key),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS completed (
    user_id INTEGER NOT NULL,
    difficulty TEXT NOT NULL,
    puzzle_index INTEGER NOT NULL,
    clear_time INTEGER,
    completed_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, difficulty, puzzle_index),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// Prepared statements
const stmts = {
  findUser: db.prepare("SELECT * FROM users WHERE username = ?"),
  createUser: db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)"),
  createSession: db.prepare("INSERT INTO sessions (token, user_id) VALUES (?, ?)"),
  findSession: db.prepare("SELECT s.user_id, u.username FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ?"),
  deleteSession: db.prepare("DELETE FROM sessions WHERE token = ?"),
  deleteUserSessions: db.prepare("DELETE FROM sessions WHERE user_id = ?"),

  getProgress: db.prepare("SELECT puzzle_key, data FROM progress WHERE user_id = ?"),
  upsertProgress: db.prepare("INSERT OR REPLACE INTO progress (user_id, puzzle_key, data, updated_at) VALUES (?, ?, ?, datetime('now'))"),
  deleteProgress: db.prepare("DELETE FROM progress WHERE user_id = ? AND puzzle_key = ?"),

  getCompleted: db.prepare("SELECT difficulty, puzzle_index, clear_time FROM completed WHERE user_id = ?"),
  upsertCompleted: db.prepare("INSERT OR REPLACE INTO completed (user_id, difficulty, puzzle_index, clear_time, completed_at) VALUES (?, ?, ?, ?, datetime('now'))"),
};

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// 인증 미들웨어
function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "로그인이 필요합니다" });

  const session = stmts.findSession.get(token);
  if (!session) return res.status(401).json({ error: "세션이 만료되었습니다" });

  req.userId = session.user_id;
  req.username = session.username;
  next();
}

// === 인증 API ===

// 회원가입
app.post("/api/register", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "아이디와 비밀번호를 입력하세요" });
  if (username.length < 2 || username.length > 20) return res.status(400).json({ error: "아이디는 2~20자로 입력하세요" });
  if (password.length < 4) return res.status(400).json({ error: "비밀번호는 4자 이상 입력하세요" });

  const existing = stmts.findUser.get(username);
  if (existing) return res.status(409).json({ error: "이미 존재하는 아이디입니다" });

  const hash = bcrypt.hashSync(password, 10);
  const result = stmts.createUser.run(username, hash);
  const token = crypto.randomBytes(32).toString("hex");
  stmts.createSession.run(token, result.lastInsertRowid);

  res.json({ token, username });
});

// 로그인
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "아이디와 비밀번호를 입력하세요" });

  const user = stmts.findUser.get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "아이디 또는 비밀번호가 잘못되었습니다" });
  }

  const token = crypto.randomBytes(32).toString("hex");
  stmts.createSession.run(token, user.id);

  res.json({ token, username: user.username });
});

// 로그아웃
app.post("/api/logout", authenticate, (req, res) => {
  const token = req.headers.authorization.replace("Bearer ", "");
  stmts.deleteSession.run(token);
  res.json({ ok: true });
});

// 현재 사용자 확인
app.get("/api/me", authenticate, (req, res) => {
  res.json({ username: req.username });
});

// === 데이터 API ===

// 진행 상황 전체 가져오기
app.get("/api/data", authenticate, (req, res) => {
  const progressRows = stmts.getProgress.all(req.userId);
  const completedRows = stmts.getCompleted.all(req.userId);

  const progress = {};
  for (const row of progressRows) {
    progress[row.puzzle_key] = JSON.parse(row.data);
  }

  const completed = {};
  for (const row of completedRows) {
    if (!completed[row.difficulty]) completed[row.difficulty] = [];
    completed[row.difficulty].push({ index: row.puzzle_index, clearTime: row.clear_time });
  }

  res.json({ progress, completed });
});

// 진행 상황 저장
app.post("/api/progress", authenticate, (req, res) => {
  const { puzzleKey, data } = req.body;
  if (!puzzleKey || !data) return res.status(400).json({ error: "데이터가 부족합니다" });

  stmts.upsertProgress.run(req.userId, puzzleKey, JSON.stringify(data));
  res.json({ ok: true });
});

// 진행 상황 삭제
app.delete("/api/progress/:puzzleKey", authenticate, (req, res) => {
  stmts.deleteProgress.run(req.userId, req.params.puzzleKey);
  res.json({ ok: true });
});

// 완료 기록
app.post("/api/completed", authenticate, (req, res) => {
  const { difficulty, puzzleIndex, clearTime } = req.body;
  if (!difficulty || puzzleIndex == null) return res.status(400).json({ error: "데이터가 부족합니다" });

  stmts.upsertCompleted.run(req.userId, difficulty, puzzleIndex, clearTime || 0);
  // 해당 진행 상황 삭제
  stmts.deleteProgress.run(req.userId, `${difficulty}_${puzzleIndex}`);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Sudoku server running on port ${PORT}`);
});
