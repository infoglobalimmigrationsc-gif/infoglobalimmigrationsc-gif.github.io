// server.js - COMPLETE VERSION WITH ADMIN LOGIN
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { MongoClient, GridFSBucket } = require('mongodb'); 
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();

// ============================================================
// MONGODB CONNECTION
// ============================================================
const MONGODB_URI = process.env.MONGODB_URI;
let db;
let bucket;

async function connectDB() {
    try {
        const client = new MongoClient(MONGODB_URI);
        await client.connect();
        console.log('✅ Connected to MongoDB');
        db = client.db('gisc-app');
        bucket = new GridFSBucket(db, {
            bucketName: 'documents'
        });
        console.log('✅ GridFS Bucket initialized');
        return client;
    } catch (error) {
        console.error('❌ MongoDB connection error:', error);
        throw error;
    }
}

connectDB();

// ============================================================
// CORS CONFIGURATION
// ============================================================
app.use(cors({
    origin: [
        'https://globalimmigrationsclr.com',
        'https://www.globalimmigrationsclr.com',
        'http://localhost:5500',
        'http://127.0.0.1:5500',
        'https://gisc-app-production.up.railway.app'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With'],
    credentials: true
}));

app.options('*', cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ============================================================
// ADMIN AUTHENTICATION
// ============================================================
app.post('/api/admin/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        console.log(`🔐 Admin login attempt: ${email}`);

        if (!db) {
            return res.status(500).json({ 
                success: false, 
                message: 'Database not connected' 
            });
        }

        const admin = await db.collection('admins').findOne({ email: email });
        
        if (!admin) {
            console.log(`❌ Admin not found: ${email}`);
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        const isValidPassword = await bcrypt.compare(password, admin.password);
        
        if (!isValidPassword) {
            console.log(`❌ Invalid password for: ${email}`);
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        const token = jwt.sign(
            { id: admin._id, email: admin.email, role: admin.role || 'admin' },
            process.env.JWT_SECRET || 'your-secret-key-change-me',
            { expiresIn: '24h' }
        );

        console.log(`✅ Admin logged in: ${email}`);

        res.json({
            success: true,
            token: token,
            admin: {
                id: admin._id,
                name: admin.name,
                email: admin.email,
                role: admin.role || 'admin'
            }
        });

    } catch (error) {
        console.error('❌ Admin login error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Server error'
        });
    }
});

// ============================================================
// FILE UPLOAD CONFIGURATION
// ============================================================
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'image/jpeg', 'image/png', 'image/jpg',
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only PDF, JPG, PNG, DOC are allowed.'));
        }
    }
});

// ============================================================
// UPLOAD ENDPOINT
// ============================================================
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        console.log('📤 Upload request received');
        
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No file uploaded'
            });
        }

        if (!db || !bucket) {
            return res.status(500).json({
                success: false,
                message: 'Database not connected'
            });
        }

        const file = req.file;
        const userId = req.body.userId || 'unknown';
        const docType = req.body.docType || 'other';

        const fileId = new Date().getTime().toString(36) + '_' + uuidv4();
        const fileName = `${userId}_${docType}_${fileId}_${file.originalname}`;

        const uploadStream = bucket.openUploadStream(fileName, {
            contentType: file.mimetype,
            metadata: {
                userId: userId,
                docType: docType,
                originalName: file.originalname,
                uploadedAt: new Date().toISOString(),
                fileSize: file.size,
                fileId: fileId
            }
        });

        await new Promise((resolve, reject) => {
            uploadStream.write(file.buffer, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        await new Promise((resolve, reject) => {
            uploadStream.end((err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        const fileUrl = `https://gisc-app-production.up.railway.app/api/file/${uploadStream.id}`;

        res.json({
            success: true,
            url: fileUrl,
            fileId: uploadStream.id,
            fileName: file.originalname,
            fileSize: file.size,
            fileType: file.mimetype,
            message: 'File uploaded successfully'
        });

    } catch (error) {
        console.error('❌ Upload error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Upload failed'
        });
    }
});

// ============================================================
// DOWNLOAD FILE
// ============================================================
app.get('/api/file/:id', async (req, res) => {
    try {
        const fileId = req.params.id;
        const ObjectId = require('mongodb').ObjectId;
        const downloadStream = bucket.openDownloadStream(new ObjectId(fileId));

        downloadStream.on('error', (error) => {
            res.status(404).json({ success: false, message: 'File not found' });
        });

        downloadStream.pipe(res);

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// GET USER DOCUMENTS
// ============================================================
app.get('/api/documents/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;

        const files = await db.collection('documents.files')
            .find({ 'metadata.userId': userId })
            .sort({ uploadDate: -1 })
            .toArray();

        const documents = files.map(file => ({
            id: file._id,
            fileName: file.metadata.originalName || file.filename.split('_').pop(),
            fileSize: file.length,
            fileType: file.contentType,
            uploadedAt: file.uploadDate,
            docType: file.metadata.docType || 'other',
            url: `https://gisc-app-production.up.railway.app/api/file/${file._id}`
        }));

        res.json({
            success: true,
            documents: documents
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/api/health', async (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'Global Immigration SC API',
        database: db ? 'connected' : 'disconnected',
        uptime: process.uptime()
    });
});

// ============================================================
// ROOT ENDPOINT
// ============================================================
app.get('/', (req, res) => {
    res.json({
        name: 'Global Immigration SC API',
        version: '1.0.0',
        status: 'running',
        endpoints: {
            admin_login: '/api/admin/login (POST)',
            upload: '/api/upload (POST)',
            download: '/api/file/:id (GET)',
            documents: '/api/documents/:userId (GET)',
            health: '/api/health (GET)'
        }
    });
});

// ============================================================
// START SERVER
// ============================================================
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📍 URL: https://gisc-app-production.up.railway.app`);
    console.log(`📍 MongoDB: ${MONGODB_URI ? 'Configured' : 'Not configured'}`);
});
