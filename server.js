/**
 * Kirinyaga Gala Awards — Backend entry.
 * Deploy target: Render.com (Web Service, Node).
 *
 * Serves:
 *   - REST API under /api/*
 *   - Static admin dashboard from /public (available at /admin.html and /)
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

require('./src/db'); // ensures DB is initialised & seeded

const publicRoutes = require('./src/routes/publicRoutes');
const authRoutes = require('./src/routes/authRoutes');
const voteRoutes = require('./src/routes/voteRoutes');
const adminRoutes = require('./src/routes/adminRoutes');

const app = express();
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: false }));
app.use(express.json({ limit: '200kb' }));

// Rate limits
const generalLimiter = rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false });
const voteLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60_000, max: 30, standardHeaders: true, legacyHeaders: false });

app.use('/api/', generalLimiter);
app.use('/api/auth/', authLimiter);
app.use('/api/vote/', voteLimiter);

// Routes
app.use('/api', publicRoutes);
app.use('/api/auth', authRoutes);
app.use('/api', voteRoutes);
app.use('/api', adminRoutes);

// Static admin dashboard (public/)
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.redirect('/admin.html'));

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`[gala] Backend running on :${PORT} (mode=${process.env.MPESA_MODE || 'simulation'})`);
});
