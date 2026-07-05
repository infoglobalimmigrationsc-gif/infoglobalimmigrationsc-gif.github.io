// server.js - COMPLETE WORKING FIXED VERSION
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { MongoClient, GridFSBucket } = require('mongodb');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();

// ============================================================
// CORS
// ============================================================
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: true
}));

app.options('*', cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ============================================================
// MONGODB CONNECTION - FIXED
// ============================================================
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://giscadmin:GISCsecure2024!@ac-lfqluos-shard-00-00.rkaqbht.mongodb.net:27017,ac-lfqluos-shard-00-01.rkaqbht.mongodb.net:27017,ac-lfqluos-shard-00-02.rkaqbht.mongodb.net:27017/gisc-app?ssl=true&replicaSet=atlas-r7gnc7-shard-0&authSource=admin&retryWrites=true&w=majority&appName=GISCAPP0";

let db;
let bucket;
let client;

async function connectDB() {
    try {
        console.log('🔄 Connecting to MongoDB...');
        client = new MongoClient(MONGODB_URI);
        await client.connect();
        console.log('✅ Connected to MongoDB');
        
        db = client.db('gisc-app');
        console.log('✅ Using database: gisc-app');
        
        // Test the connection
        const collections = await db.listCollections().toArray();
        console.log('📁 Collections:', collections.map(c => c.name).join(', '));
        
        // Check admin
        const admin = await db.collection('admins').findOne({ email: 'admin@globalimmigrationsc.com' });
        if (admin) {
            console.log('✅ Admin found!');
            console.log(`📧 Email: ${admin.email}`);
            console.log(`🔑 Hash: ${admin.password.substring(0, 30)}...`);
        } else {
            console.log('❌ Admin NOT found - creating one...');
            const hashedPassword = await bcrypt.hash('@Motiva6060', 12);
            await db.collection('admins').insertOne({
                name: 'Super Admin',
                email: 'admin@globalimmigrationsc.com',
                password: hashedPassword,
                role: 'super_admin',
                createdAt: new Date(),
                updatedAt: new Date()
            });
            console.log('✅ Admin created with password: @Motiva6060');
        }
        
        bucket = new GridFSBucket(db, { bucketName: 'documents' });
        console.log('✅ GridFS Bucket initialized');
        return db;
    } catch (error) {
        console.error('❌ MongoDB connection error:', error);
        throw error;
    }
}

// Connect NOW
connectDB().catch(console.error);

// ============================================================
// ADMIN LOGIN - FIXED
// ============================================================
app.post('/api/admin/login', async (req, res) => {
    console.log('🔐 Admin login attempt');
    
    try {
        const { email, password } = req.body;
        console.log(`📧 Email: ${email}`);

        if (!db) {
            console.log('❌ Database not connected');
            return res.status(503).json({
                success: false,
                message: 'Database not connected'
            });
        }

        // Find admin
        const admin = await db.collection('admins').findOne({ email: email });
        
        if (!admin) {
            console.log(`❌ Admin not found: ${email}`);
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        console.log(`✅ Admin found: ${admin.name}`);

        // Verify password
        const isValid = await bcrypt.compare(password, admin.password);
        console.log(`🔑 Password valid: ${isValid}`);
        
        if (!isValid) {
            console.log(`❌ Invalid password`);
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        // Generate token
        const token = jwt.sign(
            { id: admin._id, email: admin.email, role: admin.role || 'admin' },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '24h' }
        );

        console.log(`✅ Login successful: ${email}`);
        
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
        console.error('❌ Login error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Server error'
        });
    }
});

// ============================================================
// TEST ENDPOINT - For debugging
// ============================================================
app.get('/api/admin/test', async (req, res) => {
    try {
        if (!db) {
            return res.json({ connected: false, message: 'Database not connected' });
        }
        const admins = await db.collection('admins').find({}).toArray();
        res.json({
            connected: true,
            adminCount: admins.length,
            admins: admins.map(a => ({ email: a.email, name: a.name }))
        });
    } catch (error) {
        res.json({ error: error.message });
    }
});

// ============================================================
// UPLOAD ENDPOINT
// ============================================================
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only PDF, JPG, PNG, DOC are allowed.'));
        }
    }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }
        if (!db || !bucket) {
            return res.status(500).json({ success: false, message: 'Database not connected' });
        }

        const file = req.file;
        const userId = req.body.userId || 'unknown';
        const docType = req.body.docType || 'other';
        const fileId = Date.now().toString(36) + '_' + uuidv4();
        const fileName = `${userId}_${docType}_${fileId}_${file.originalname}`;

        const uploadStream = bucket.openUploadStream(fileName, {
            contentType: file.mimetype,
            metadata: {
                userId, docType,
                originalName: file.originalname,
                uploadedAt: new Date().toISOString(),
                fileSize: file.size,
                fileId
            }
        });

        await new Promise((resolve, reject) => {
            uploadStream.write(file.buffer, (err) => { if (err) reject(err); else resolve(); });
        });
        await new Promise((resolve, reject) => {
            uploadStream.end((err) => { if (err) reject(err); else resolve(); });
        });

        res.json({
            success: true,
            url: `https://gisc-app-production.up.railway.app/api/file/${uploadStream.id}`,
            fileId: uploadStream.id,
            fileName: file.originalname,
            fileSize: file.size,
            fileType: file.mimetype
        });

    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// DOWNLOAD FILE
// ============================================================
app.get('/api/file/:id', async (req, res) => {
    try {
        const ObjectId = require('mongodb').ObjectId;
        const downloadStream = bucket.openDownloadStream(new ObjectId(req.params.id));
        downloadStream.on('error', () => res.status(404).json({ success: false, message: 'File not found' }));
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
        const files = await db.collection('documents.files')
            .find({ 'metadata.userId': req.params.userId })
            .sort({ uploadDate: -1 })
            .toArray();

        res.json({
            success: true,
            documents: files.map(file => ({
                id: file._id,
                fileName: file.metadata.originalName || file.filename.split('_').pop(),
                fileSize: file.length,
                fileType: file.contentType,
                uploadedAt: file.uploadDate,
                docType: file.metadata.docType || 'other',
                url: `https://gisc-app-production.up.railway.app/api/file/${file._id}`
            }))
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
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
        database: db ? 'connected' : 'disconnected',
        uptime: process.uptime()
    });
});

// ============================================================
// ROOT
// ============================================================
app.get('/', (req, res) => {
    res.json({
        name: 'Global Immigration SC API',
        version: '1.0.0',
        status: 'running',
        endpoints: {
            admin_login: '/api/admin/login (POST)',
            admin_test: '/api/admin/test (GET)',
            upload: '/api/upload (POST)',
            download: '/api/file/:id (GET)',
            documents: '/api/documents/:userId (GET)',
            health: '/api/health (GET)'
        }
    });
});

// ============================================================
// ADMIN API ENDPOINTS - Add to server.js
// ============================================================

// Middleware to verify JWT token
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
        if (err) {
            return res.status(403).json({ success: false, message: 'Invalid token' });
        }
        req.user = user;
        next();
    });
}

// GET all users
app.get('/api/admin/users', authenticateToken, async (req, res) => {
    try {
        const users = await db.collection('users').find({}).toArray();
        res.json({ success: true, users });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET all applications
app.get('/api/admin/applications', authenticateToken, async (req, res) => {
    try {
        const applications = await db.collection('applications').find({}).toArray();
        res.json({ success: true, applications });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET single application
app.get('/api/admin/applications/:id', authenticateToken, async (req, res) => {
    try {
        const ObjectId = require('mongodb').ObjectId;
        const application = await db.collection('applications').findOne({ _id: new ObjectId(req.params.id) });
        res.json({ success: true, application });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// UPDATE application status
app.put('/api/admin/applications/:id', authenticateToken, async (req, res) => {
    try {
        const ObjectId = require('mongodb').ObjectId;
        const { status } = req.body;
        await db.collection('applications').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { status, updatedAt: new Date() } }
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET all blogs
app.get('/api/admin/blogs', authenticateToken, async (req, res) => {
    try {
        const blogs = await db.collection('blogs').find({}).sort({ createdAt: -1 }).toArray();
        res.json({ success: true, blogs });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET single blog
app.get('/api/admin/blogs/:id', authenticateToken, async (req, res) => {
    try {
        const ObjectId = require('mongodb').ObjectId;
        const blog = await db.collection('blogs').findOne({ _id: new ObjectId(req.params.id) });
        res.json({ success: true, blog });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// CREATE blog post
app.post('/api/admin/blogs', authenticateToken, async (req, res) => {
    try {
        const blogData = {
            ...req.body,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        const result = await db.collection('blogs').insertOne(blogData);
        res.json({ success: true, id: result.insertedId });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// UPDATE blog post
app.put('/api/admin/blogs/:id', authenticateToken, async (req, res) => {
    try {
        const ObjectId = require('mongodb').ObjectId;
        const { id } = req.params;
        const updateData = { ...req.body, updatedAt: new Date() };
        delete updateData._id;
        delete updateData.createdAt;
        await db.collection('blogs').updateOne(
            { _id: new ObjectId(id) },
            { $set: updateData }
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// DELETE blog post
app.delete('/api/admin/blogs/:id', authenticateToken, async (req, res) => {
    try {
        const ObjectId = require('mongodb').ObjectId;
        await db.collection('blogs').deleteOne({ _id: new ObjectId(req.params.id) });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET all contacts
app.get('/api/admin/contacts', authenticateToken, async (req, res) => {
    try {
        const contacts = await db.collection('contacts').find({}).sort({ createdAt: -1 }).toArray();
        res.json({ success: true, contacts });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// DELETE contact
app.delete('/api/admin/contacts/:id', authenticateToken, async (req, res) => {
    try {
        const ObjectId = require('mongodb').ObjectId;
        await db.collection('contacts').deleteOne({ _id: new ObjectId(req.params.id) });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Generate Firebase custom token (optional - for Firestore access)
app.get('/api/admin/firebase-token', authenticateToken, async (req, res) => {
    try {
        // This requires Firebase Admin SDK
        // const customToken = await admin.auth().createCustomToken(req.user.email);
        // res.json({ success: true, customToken });
        res.json({ success: false, message: 'Firebase Admin SDK not configured' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// START
// ============================================================
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📍 URL: https://gisc-app-production.up.railway.app`);
});
