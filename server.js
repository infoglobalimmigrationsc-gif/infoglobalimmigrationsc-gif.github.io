// server.js - COMPLETE WORKING FIXED VERSION
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { MongoClient, GridFSBucket, ObjectId } = require('mongodb');
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
// MONGODB CONNECTION
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
// MIDDLEWARE - JWT Authentication
// ============================================================
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

// ============================================================
// ADMIN LOGIN
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

        const admin = await db.collection('admins').findOne({ email: email });
        
        if (!admin) {
            console.log(`❌ Admin not found: ${email}`);
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        console.log(`✅ Admin found: ${admin.name}`);

        const isValid = await bcrypt.compare(password, admin.password);
        console.log(`🔑 Password valid: ${isValid}`);
        
        if (!isValid) {
            console.log(`❌ Invalid password`);
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

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
// TEST ENDPOINT
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
            health: '/api/health (GET)',
            admin_users: '/api/admin/users (GET, POST)',
            admin_applications: '/api/admin/applications (GET, PUT)',
            admin_blogs: '/api/admin/blogs (GET, POST, PUT, DELETE)',
            admin_contacts: '/api/admin/contacts (GET, DELETE)'
        }
    });
});

// ============================================================
// ============================================================
// ADMIN API ENDPOINTS
// ============================================================
// ============================================================

// ============================================================
// USERS - GET all
// ============================================================
app.get('/api/admin/users', authenticateToken, async (req, res) => {
    try {
        const users = await db.collection('users').find({}).toArray();
        console.log(`📋 GET /api/admin/users - Found ${users.length} users`);
        res.json({ success: true, users });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// USERS - CREATE new user
// ============================================================
app.post('/api/admin/users', authenticateToken, async (req, res) => {
    try {
        const { email, name, phone, countryOfInterest, userType } = req.body;
        
        // Check if user already exists
        const existingUser = await db.collection('users').findOne({ email });
        if (existingUser) {
            return res.status(400).json({ 
                success: false, 
                message: 'User with this email already exists' 
            });
        }
        
        const userData = {
            email,
            name: name || 'Unknown',
            phone: phone || '',
            countryOfInterest: countryOfInterest || 'USA',
            userType: userType || 'applicant',
            createdAt: new Date(),
            updatedAt: new Date()
        };
        
        const result = await db.collection('users').insertOne(userData);
        console.log(`✅ Created user: ${email}`);
        res.json({ 
            success: true, 
            id: result.insertedId, 
            user: { ...userData, _id: result.insertedId } 
        });
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// USERS - DELETE user
// ============================================================
app.delete('/api/admin/users/:id', authenticateToken, async (req, res) => {
    try {
        const result = await db.collection('users').deleteOne({ _id: new ObjectId(req.params.id) });
        if (result.deletedCount === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        console.log(`✅ Deleted user: ${req.params.id}`);
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// USERS - SYNC from Firebase (placeholder)
// ============================================================
app.post('/api/admin/sync-users', authenticateToken, async (req, res) => {
    try {
        // This would normally call Firebase Admin SDK to list users
        // For now, just return a message
        res.json({ 
            success: true, 
            synced: 0, 
            message: 'Sync functionality requires Firebase Admin SDK setup. Users are added via registration or manually.' 
        });
    } catch (error) {
        console.error('Sync error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// APPLICATIONS - GET all
// ============================================================
app.get('/api/admin/applications', authenticateToken, async (req, res) => {
    try {
        const applications = await db.collection('applications').find({}).toArray();
        console.log(`📋 GET /api/admin/applications - Found ${applications.length} applications`);
        res.json({ success: true, applications });
    } catch (error) {
        console.error('Error fetching applications:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// APPLICATIONS - GET single
// ============================================================
app.get('/api/admin/applications/:id', authenticateToken, async (req, res) => {
    try {
        const application = await db.collection('applications').findOne({ _id: new ObjectId(req.params.id) });
        if (!application) {
            return res.status(404).json({ success: false, message: 'Application not found' });
        }
        res.json({ success: true, application });
    } catch (error) {
        console.error('Error fetching application:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// APPLICATIONS - UPDATE status
// ============================================================
app.put('/api/admin/applications/:id', authenticateToken, async (req, res) => {
    try {
        const { status } = req.body;
        const result = await db.collection('applications').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { status, updatedAt: new Date() } }
        );
        if (result.matchedCount === 0) {
            return res.status(404).json({ success: false, message: 'Application not found' });
        }
        console.log(`✅ Updated application ${req.params.id} status to ${status}`);
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating application:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// BLOGS - GET all
// ============================================================
app.get('/api/admin/blogs', authenticateToken, async (req, res) => {
    try {
        const blogs = await db.collection('blogs').find({}).sort({ createdAt: -1 }).toArray();
        console.log(`📋 GET /api/admin/blogs - Found ${blogs.length} blogs`);
        res.json({ success: true, blogs });
    } catch (error) {
        console.error('Error fetching blogs:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// BLOGS - GET single
// ============================================================
app.get('/api/admin/blogs/:id', authenticateToken, async (req, res) => {
    try {
        const blog = await db.collection('blogs').findOne({ _id: new ObjectId(req.params.id) });
        if (!blog) {
            return res.status(404).json({ success: false, message: 'Blog not found' });
        }
        res.json({ success: true, blog });
    } catch (error) {
        console.error('Error fetching blog:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// BLOGS - CREATE
// ============================================================
app.post('/api/admin/blogs', authenticateToken, async (req, res) => {
    try {
        const blogData = {
            ...req.body,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        const result = await db.collection('blogs').insertOne(blogData);
        console.log(`✅ Created blog: ${blogData.title}`);
        res.json({ success: true, id: result.insertedId, blog: blogData });
    } catch (error) {
        console.error('Error creating blog:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// BLOGS - UPDATE
// ============================================================
app.put('/api/admin/blogs/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = { ...req.body, updatedAt: new Date() };
        delete updateData._id;
        delete updateData.createdAt;
        
        const result = await db.collection('blogs').updateOne(
            { _id: new ObjectId(id) },
            { $set: updateData }
        );
        if (result.matchedCount === 0) {
            return res.status(404).json({ success: false, message: 'Blog not found' });
        }
        console.log(`✅ Updated blog: ${id}`);
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating blog:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// BLOGS - DELETE
// ============================================================
app.delete('/api/admin/blogs/:id', authenticateToken, async (req, res) => {
    try {
        const result = await db.collection('blogs').deleteOne({ _id: new ObjectId(req.params.id) });
        if (result.deletedCount === 0) {
            return res.status(404).json({ success: false, message: 'Blog not found' });
        }
        console.log(`✅ Deleted blog: ${req.params.id}`);
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting blog:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// CONTACTS - GET all
// ============================================================
app.get('/api/admin/contacts', authenticateToken, async (req, res) => {
    try {
        const contacts = await db.collection('contacts').find({}).sort({ createdAt: -1 }).toArray();
        console.log(`📋 GET /api/admin/contacts - Found ${contacts.length} contacts`);
        res.json({ success: true, contacts });
    } catch (error) {
        console.error('Error fetching contacts:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// CONTACTS - DELETE
// ============================================================
app.delete('/api/admin/contacts/:id', authenticateToken, async (req, res) => {
    try {
        const result = await db.collection('contacts').deleteOne({ _id: new ObjectId(req.params.id) });
        if (result.deletedCount === 0) {
            return res.status(404).json({ success: false, message: 'Contact not found' });
        }
        console.log(`✅ Deleted contact: ${req.params.id}`);
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting contact:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// FIREBASE TOKEN (placeholder)
// ============================================================
app.get('/api/admin/firebase-token', authenticateToken, async (req, res) => {
    try {
        res.json({ success: false, message: 'Firebase Admin SDK not configured' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// USER REGISTRATION - Create user from Firebase Auth
// ============================================================
app.post('/api/users/register', async (req, res) => {
    try {
        const { 
            uid, name, email, phone, whatsapp, dob, 
            citizenship, countryOfInterest, referral, 
            receiveUpdates, userType, accountStatus 
        } = req.body;

        if (!uid || !email) {
            return res.status(400).json({ 
                success: false, 
                message: 'uid and email are required' 
            });
        }

        // Check if user already exists in MongoDB
        const existingUser = await db.collection('users').findOne({ uid: uid });
        if (existingUser) {
            console.log(`⚠️ User already exists in MongoDB: ${email}`);
            return res.status(200).json({ 
                success: true, 
                message: 'User already exists',
                user: existingUser 
            });
        }

        // Check if email already exists
        const existingEmail = await db.collection('users').findOne({ email: email });
        if (existingEmail) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email already registered' 
            });
        }

        // Create user in MongoDB
        const userData = {
            uid: uid,
            name: name || 'Unknown',
            email: email,
            phone: phone || '',
            whatsapp: whatsapp || phone || '',
            dob: dob || '',
            citizenship: citizenship || '',
            countryOfInterest: countryOfInterest || '',
            referral: referral || '',
            receiveUpdates: receiveUpdates || false,
            userType: userType || 'applicant',
            accountStatus: accountStatus || 'active',
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection('users').insertOne(userData);
        console.log(`✅ MongoDB user created: ${email} (UID: ${uid})`);

        // Create initial application document
        const applicationData = {
            userId: uid,
            uid: uid,
            status: 'draft',
            progress: 0,
            currentStep: 'personal_info',
            personalInfo: {
                name: name || 'Unknown',
                email: email,
                phone: phone || '',
                countryOfInterest: countryOfInterest || ''
            },
            createdAt: new Date(),
            updatedAt: new Date(),
            documents: {},
            payments: [],
            notifications: [],
            uploadHistory: [],
            applicationStages: {
                personal_info: { completed: true, status: 'completed', completedAt: new Date() },
                document_upload: { completed: false, status: 'pending' },
                payment: { completed: false, status: 'pending' },
                review: { completed: false, status: 'pending' },
                approval: { completed: false, status: 'pending' }
            }
        };

        await db.collection('applications').insertOne(applicationData);
        console.log(`✅ Application created for user: ${email}`);

        res.json({ 
            success: true, 
            message: 'User registered successfully',
            user: { ...userData, _id: result.insertedId }
        });

    } catch (error) {
        console.error('❌ User registration error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// ============================================================
// GET USER BY UID
// ============================================================
app.get('/api/users/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        const user = await db.collection('users').findOne({ uid: uid });
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }
        res.json({ success: true, user });
    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// GET USER WITH APPLICATION
// ============================================================
app.get('/api/users/:uid/full', async (req, res) => {
    try {
        const { uid } = req.params;
        
        const user = await db.collection('users').findOne({ uid: uid });
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }
        
        const application = await db.collection('applications').findOne({ uid: uid });
        
        res.json({ 
            success: true, 
            user: user,
            application: application || null
        });
    } catch (error) {
        console.error('Error fetching user data:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});


// ============================================================
// START SERVER
// ============================================================
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📍 URL: https://gisc-app-production.up.railway.app`);
    console.log(`📋 Available endpoints:`);
    console.log(`   POST /api/admin/login`);
    console.log(`   GET  /api/admin/users`);
    console.log(`   POST /api/admin/users`);
    console.log(`   DELETE /api/admin/users/:id`);
    console.log(`   GET  /api/admin/applications`);
    console.log(`   GET  /api/admin/applications/:id`);
    console.log(`   PUT  /api/admin/applications/:id`);
    console.log(`   GET  /api/admin/blogs`);
    console.log(`   POST /api/admin/blogs`);
    console.log(`   PUT  /api/admin/blogs/:id`);
    console.log(`   DELETE /api/admin/blogs/:id`);
    console.log(`   GET  /api/admin/contacts`);
    console.log(`   DELETE /api/admin/contacts/:id`);
});
