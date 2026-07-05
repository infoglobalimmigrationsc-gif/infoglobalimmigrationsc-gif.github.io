// server.js - COMPLETE WORKING VERSION  
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();

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

// Handle preflight requests
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
        fileSize: 10 * 1024 * 1024 // 10MB limit
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
// CREATE UPLOADS DIRECTORY (if using local storage)
// ============================================================
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// ============================================================
// UPLOAD ENDPOINT
// ============================================================
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        console.log('📤 Upload request received');
        console.log('📋 Body:', req.body);
        console.log('📄 File:', req.file ? req.file.originalname : 'No file');
        
        if (!req.file) {
            console.log('❌ No file uploaded');
            return res.status(400).json({ 
                success: false, 
                message: 'No file uploaded' 
            });
        }

        const file = req.file;
        const userId = req.body.userId || 'unknown';
        const docType = req.body.docType || 'other';

        console.log(`📄 File: ${file.originalname}, Size: ${file.size} bytes, Type: ${docType}`);

        // Save file locally (temporary solution)
        const fileName = `${Date.now()}_${file.originalname}`;
        const filePath = path.join(uploadDir, fileName);
        
        // Write file to disk
        fs.writeFileSync(filePath, file.buffer);
        console.log(`💾 File saved to: ${filePath}`);

        // Generate URL (adjust domain as needed)
        const baseUrl = process.env.BASE_URL || 'https://gisc-app-production.up.railway.app';
        const fileUrl = `${baseUrl}/uploads/${fileName}`;

        res.json({
            success: true,
            url: fileUrl,
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
// SERVE UPLOADED FILES
// ============================================================
app.use('/uploads', express.static(uploadDir));

// ============================================================
// HEALTH CHECK ENDPOINT
// ============================================================
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'Global Immigration SC API',
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
        endpoints: {
            upload: '/api/upload (POST)',
            health: '/api/health (GET)',
            uploads: '/uploads/:filename (GET)'
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
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📍 URL: http://0.0.0.0:${PORT}`);
    console.log(`📍 CORS enabled for: https://globalimmigrationsclr.com`);
    console.log(`📁 Upload directory: ${uploadDir}`);
});
