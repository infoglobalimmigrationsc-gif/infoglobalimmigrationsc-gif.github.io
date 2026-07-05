// server.js - MongoDB GridFS Version
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { MongoClient, GridFSBucket } = require('mongodb');
const { v4: uuidv4 } = require('uuid');
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

// Connect on startup
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
// FILE UPLOAD CONFIGURATION
// ============================================================
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB
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
// UPLOAD ENDPOINT - GridFS
// ============================================================
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        console.log('📤 Upload request received');
        console.log('📋 Body:', req.body);
        
        if (!req.file) {
            console.log('❌ No file uploaded');
            return res.status(400).json({
                success: false,
                message: 'No file uploaded'
            });
        }

        if (!db || !bucket) {
            console.log('❌ Database not connected');
            return res.status(500).json({
                success: false,
                message: 'Database not connected'
            });
        }

        const file = req.file;
        const userId = req.body.userId || 'unknown';
        const docType = req.body.docType || 'other';

        console.log(`📄 File: ${file.originalname}, Size: ${file.size} bytes, Type: ${docType}`);

        // Generate unique filename
        const fileId = new Date().getTime().toString(36) + '_' + uuidv4();
        const fileName = `${userId}_${docType}_${fileId}_${file.originalname}`;

        // Create upload stream to GridFS
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

        // Write file to GridFS
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

        console.log(`✅ File saved to GridFS with ID: ${uploadStream.id}`);

        // Generate URL for file download
        const fileUrl = `https://gisc-app-production.up.railway.app/api/file/${uploadStream.id}`;

        res.json({
            success: true,
            url: fileUrl,
            fileId: uploadStream.id,
            fileName: file.originalname,
            fileSize: file.size,
            fileType: file.mimetype,
            message: 'File uploaded successfully to GridFS'
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
// DOWNLOAD FILE ENDPOINT
// ============================================================
app.get('/api/file/:id', async (req, res) => {
    try {
        const fileId = req.params.id;
        console.log(`📥 Downloading file: ${fileId}`);

        if (!db || !bucket) {
            return res.status(500).json({ success: false, message: 'Database not connected' });
        }

        const ObjectId = require('mongodb').ObjectId;
        const downloadStream = bucket.openDownloadStream(new ObjectId(fileId));

        downloadStream.on('error', (error) => {
            console.error('Download error:', error);
            res.status(404).json({ success: false, message: 'File not found' });
        });

        downloadStream.pipe(res);

    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// GET USER DOCUMENTS
// ============================================================
app.get('/api/documents/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        console.log(`📂 Listing documents for user: ${userId}`);

        if (!db || !bucket) {
            return res.status(500).json({ success: false, message: 'Database not connected' });
        }

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
        console.error('Error fetching documents:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ============================================================
// DELETE DOCUMENT
// ============================================================
app.delete('/api/documents/:id', async (req, res) => {
    try {
        const fileId = req.params.id;
        console.log(`🗑️ Deleting file: ${fileId}`);

        if (!db || !bucket) {
            return res.status(500).json({ success: false, message: 'Database not connected' });
        }

        const ObjectId = require('mongodb').ObjectId;
        await bucket.delete(new ObjectId(fileId));

        res.json({
            success: true,
            message: 'Document deleted successfully'
        });

    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/api/health', async (req, res) => {
    const dbStatus = db ? 'connected' : 'disconnected';
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'Global Immigration SC API',
        database: dbStatus,
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
            upload: '/api/upload (POST)',
            download: '/api/file/:id (GET)',
            documents: '/api/documents/:userId (GET)',
            delete: '/api/documents/:id (DELETE)',
            health: '/api/health (GET)'
        }
    });
});

// ============================================================
// ERROR HANDLING
// ============================================================
app.use((err, req, res, next) => {
    console.error('❌ Error:', err);
    res.status(500).json({
        success: false,
        message: err.message || 'Internal server error'
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
