// server.js - AWS S3 Version with proper error handling
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();

// ============================================================
// AWS S3 CONFIGURATION (Using your Railway env variables)
// ============================================================
const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || 'us-east-1'
});

const S3_BUCKET = process.env.S3_BUCKET || 'gisc-documents';

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
// UPLOAD ENDPOINT - S3 VERSION
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

        const file = req.file;
        const userId = req.body.userId || 'unknown';
        const docType = req.body.docType || 'other';

        console.log(`📄 File: ${file.originalname}, Size: ${file.size} bytes`);

        // Generate unique filename
        const fileExtension = path.extname(file.originalname);
        const fileName = `${userId}/${docType}_${Date.now()}_${uuidv4()}${fileExtension}`;

        // S3 upload parameters
        const params = {
            Bucket: S3_BUCKET,
            Key: fileName,
            Body: file.buffer,
            ContentType: file.mimetype,
            ACL: 'public-read',
            Metadata: {
                userId: userId,
                docType: docType,
                originalName: file.originalname,
                uploadedAt: new Date().toISOString()
            }
        };

        console.log(`📤 Uploading to S3: ${fileName}`);

        // Upload to S3
        const uploadResult = await s3.upload(params).promise();
        console.log(`✅ Uploaded to S3: ${uploadResult.Location}`);

        res.json({
            success: true,
            url: uploadResult.Location,
            key: uploadResult.Key,
            fileName: file.originalname,
            fileSize: file.size,
            fileType: file.mimetype,
            message: 'File uploaded successfully to S3'
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
// GET DOCUMENTS FOR USER
// ============================================================
app.get('/api/documents/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        console.log(`📂 Listing documents for user: ${userId}`);

        const params = {
            Bucket: S3_BUCKET,
            Prefix: `${userId}/`
        };

        const data = await s3.listObjectsV2(params).promise();
        
        const documents = data.Contents.map(item => ({
            key: item.Key,
            fileName: item.Key.split('/').pop(),
            size: item.Size,
            lastModified: item.LastModified,
            url: `https://${S3_BUCKET}.s3.amazonaws.com/${item.Key}`
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
app.delete('/api/documents/:userId/:docKey', async (req, res) => {
    try {
        const { userId, docKey } = req.params;
        const key = `${userId}/${docKey}`;

        const params = {
            Bucket: S3_BUCKET,
            Key: key
        };

        await s3.deleteObject(params).promise();
        console.log(`🗑️ Deleted: ${key}`);

        res.json({
            success: true,
            message: 'Document deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting document:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'Global Immigration SC API',
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'production'
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
            documents: '/api/documents/:userId (GET)',
            delete: '/api/documents/:userId/:docKey (DELETE)',
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
    console.log(`📍 Environment: ${process.env.NODE_ENV || 'production'}`);
    console.log(`📍 S3 Bucket: ${S3_BUCKET}`);
    console.log(`📍 CORS enabled for: https://globalimmigrationsclr.com`);
});
