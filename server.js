// server.js - COMPLETE WORKING FIXED VERSION (No nodemailer)
const express = require('express'); 
const multer = require('multer');
const cors = require('cors');
const { MongoClient, GridFSBucket, ObjectId } = require('mongodb');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

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
        
        const collections = await db.listCollections().toArray();
        console.log('📁 Collections:', collections.map(c => c.name).join(', '));
        
        const admin = await db.collection('admins').findOne({ email: 'admin@globalimmigrationsc.com' });
        if (admin) {
            console.log('✅ Admin found!');
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

connectDB().catch(console.error);

// ============================================================
// PASSWORD RESET - Custom Flow (Backend) - NO EMAIL MODULE
// ============================================================

// 1. Generate reset token and send email (console only)
app.post('/api/users/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({ success: false, message: 'Email is required' });
        }

        if (!db) {
            return res.status(503).json({ success: false, message: 'Database not connected' });
        }

        // Find user in MongoDB
        const user = await db.collection('users').findOne({ email: email });
        if (!user) {
            return res.status(404).json({ success: false, message: 'No account found with this email address.' });
        }

        // Generate a secure random token
        const crypto = require('crypto');
        const resetToken = crypto.randomBytes(32).toString('hex');
        const tokenExpiry = new Date();
        tokenExpiry.setHours(tokenExpiry.getHours() + 1); // 1 hour expiry

        // Store token in user document
        await db.collection('users').updateOne(
            { email: email },
            { 
                $set: { 
                    resetToken: resetToken,
                    resetTokenExpiry: tokenExpiry
                }
            }
        );

        // Create reset link using your custom domain
        const resetLink = `https://globalimmigrationsclr.com/portal/reset-password.html?token=${resetToken}`;

        // Log the link for testing
        console.log(`🔗 🔗 🔗 RESET LINK FOR ${email}: ${resetLink} 🔗 🔗 🔗`);

        // Return the link in the response for testing
        res.json({ 
            success: true, 
            message: 'Password reset link generated. Check the server logs for the link.',
            debugLink: resetLink
        });

    } catch (error) {
        console.error('Error in forgot-password:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// 2. Verify token and reset password
app.post('/api/users/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        
        if (!token || !newPassword) {
            return res.status(400).json({ success: false, message: 'Token and password are required' });
        }

        if (!db) {
            return res.status(503).json({ success: false, message: 'Database not connected' });
        }

        // Find user with valid token
        const user = await db.collection('users').findOne({ 
            resetToken: token,
            resetTokenExpiry: { $gt: new Date() }
        });

        if (!user) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid or expired reset token. Please request a new one.' 
            });
        }

        // Hash the new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update user password and clear token
        await db.collection('users').updateOne(
            { _id: user._id },
            { 
                $set: { 
                    password: hashedPassword,
                    updatedAt: new Date()
                },
                $unset: {
                    resetToken: "",
                    resetTokenExpiry: ""
                }
            }
        );

        res.json({ success: true, message: 'Password reset successfully' });

    } catch (error) {
        console.error('Error in reset-password:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

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
        if (!db) {
            return res.status(503).json({ success: false, message: 'Database not connected' });
        }
        const admin = await db.collection('admins').findOne({ email: email });
        if (!admin) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
        const isValid = await bcrypt.compare(password, admin.password);
        if (!isValid) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
        const token = jwt.sign(
            { id: admin._id, email: admin.email, role: admin.role || 'admin' },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '24h' }
        );
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
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// TEST ENDPOINT
// ============================================================
app.get('/api/admin/test', async (req, res) => {
    try {
        if (!db) {
            return res.json({ connected: false });
        }
        const admins = await db.collection('admins').find({}).toArray();
        res.json({ connected: true, adminCount: admins.length });
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
// GET USER DOCUMENTS (GridFS)
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
            upload: '/api/upload (POST)',
            download: '/api/file/:id (GET)',
            health: '/api/health (GET)'
        }
    });
});

// ============================================================
// ADMIN API ENDPOINTS
// ============================================================

app.get('/api/admin/users', authenticateToken, async (req, res) => {
    try {
        const users = await db.collection('users').find({}).toArray();
        const applications = await db.collection('applications').find({}).toArray();
        const appMap = {};
        applications.forEach(app => {
            if (app.uid) appMap[app.uid] = app;
            if (app.userId) appMap[app.userId] = app;
        });
        const enrichedUsers = users.map(user => {
            const app = appMap[user.uid] || appMap[user.userId] || null;
            return {
                ...user,
                application: app,
                documentCount: app && app.documents ? Object.keys(app.documents).length : 0,
                applicationStatus: app ? app.status : 'no_application',
                uploadHistory: app ? app.uploadHistory || [] : [],
                paymentReceipt: app ? app.paymentReceipt || null : null
            };
        });
        res.json({ success: true, users: enrichedUsers });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/users', authenticateToken, async (req, res) => {
    try {
        const { email, name, phone, countryOfInterest, userType } = req.body;
        const existingUser = await db.collection('users').findOne({ email });
        if (existingUser) {
            return res.status(400).json({ success: false, message: 'User with this email already exists' });
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
        res.json({ success: true, id: result.insertedId, user: { ...userData, _id: result.insertedId } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.delete('/api/admin/users/:id', authenticateToken, async (req, res) => {
    try {
        const result = await db.collection('users').deleteOne({ _id: new ObjectId(req.params.id) });
        if (result.deletedCount === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/sync-users', authenticateToken, async (req, res) => {
    try {
        res.json({ success: true, synced: 0, message: 'Sync requires Firebase Admin SDK' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/admin/applications', authenticateToken, async (req, res) => {
    try {
        const applications = await db.collection('applications').find({}).toArray();
        res.json({ success: true, applications });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/admin/applications/:id', authenticateToken, async (req, res) => {
    try {
        const application = await db.collection('applications').findOne({ _id: new ObjectId(req.params.id) });
        if (!application) {
            return res.status(404).json({ success: false, message: 'Application not found' });
        }
        res.json({ success: true, application });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

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
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/admin/blogs', authenticateToken, async (req, res) => {
    try {
        const blogs = await db.collection('blogs').find({}).sort({ createdAt: -1 }).toArray();
        res.json({ success: true, blogs });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/admin/blogs/:id', authenticateToken, async (req, res) => {
    try {
        const blog = await db.collection('blogs').findOne({ _id: new ObjectId(req.params.id) });
        if (!blog) {
            return res.status(404).json({ success: false, message: 'Blog not found' });
        }
        res.json({ success: true, blog });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/blogs', authenticateToken, async (req, res) => {
    try {
        const blogData = { ...req.body, createdAt: new Date(), updatedAt: new Date() };
        const result = await db.collection('blogs').insertOne(blogData);
        res.json({ success: true, id: result.insertedId, blog: blogData });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

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
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.delete('/api/admin/blogs/:id', authenticateToken, async (req, res) => {
    try {
        const result = await db.collection('blogs').deleteOne({ _id: new ObjectId(req.params.id) });
        if (result.deletedCount === 0) {
            return res.status(404).json({ success: false, message: 'Blog not found' });
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/admin/contacts', authenticateToken, async (req, res) => {
    try {
        const contacts = await db.collection('contacts').find({}).sort({ createdAt: -1 }).toArray();
        res.json({ success: true, contacts });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.delete('/api/admin/contacts/:id', authenticateToken, async (req, res) => {
    try {
        const result = await db.collection('contacts').deleteOne({ _id: new ObjectId(req.params.id) });
        if (result.deletedCount === 0) {
            return res.status(404).json({ success: false, message: 'Contact not found' });
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// USER API ENDPOINTS
// ============================================================

app.post('/api/users/register', async (req, res) => {
    try {
        const { uid, name, email, phone, whatsapp, dob, citizenship, countryOfInterest, referral, receiveUpdates, userType, accountStatus } = req.body;
        if (!uid || !email) {
            return res.status(400).json({ success: false, message: 'uid and email are required' });
        }
        const existingUser = await db.collection('users').findOne({ uid: uid });
        if (existingUser) {
            return res.status(200).json({ success: true, message: 'User already exists', user: existingUser });
        }
        const existingEmail = await db.collection('users').findOne({ email: email });
        if (existingEmail) {
            return res.status(400).json({ success: false, message: 'Email already registered' });
        }
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
            paymentReceipt: null,
            applicationStages: {
                personal_info: { completed: true, status: 'completed', completedAt: new Date() },
                document_upload: { completed: false, status: 'pending' },
                payment: { completed: false, status: 'pending' },
                review: { completed: false, status: 'pending' },
                approval: { completed: false, status: 'pending' }
            }
        };
        await db.collection('applications').insertOne(applicationData);
        res.json({ success: true, message: 'User registered successfully', user: { ...userData, _id: result.insertedId } });
    } catch (error) {
        console.error('❌ User registration error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// NOTIFICATIONS - MUST COME BEFORE /api/users/:uid ROUTES
// ============================================================
app.put('/api/users/notifications', async (req, res) => {
    try {
        const { uid, notifications } = req.body;
        console.log(`📝 Updating notifications for user: ${uid}`);
        console.log(`📋 Notifications count: ${notifications ? notifications.length : 0}`);
        
        if (!uid) {
            return res.status(400).json({ success: false, message: 'uid is required' });
        }
        
        let application = await db.collection('applications').findOne({ uid: uid });
        
        if (!application) {
            const user = await db.collection('users').findOne({ uid: uid });
            if (!user) {
                return res.status(404).json({ success: false, message: 'User not found' });
            }
            
            const newApp = {
                uid: uid,
                userId: uid,
                status: 'draft',
                progress: 0,
                currentStep: 'personal_info',
                personalInfo: {
                    name: user.name || 'Unknown',
                    email: user.email || '',
                    phone: user.phone || '',
                    countryOfInterest: user.countryOfInterest || ''
                },
                documents: {},
                payments: [],
                notifications: notifications || [],
                uploadHistory: [],
                paymentReceipt: null,
                createdAt: new Date(),
                updatedAt: new Date(),
                applicationStages: {
                    personal_info: { completed: true, status: 'completed', completedAt: new Date() },
                    document_upload: { completed: false, status: 'pending' },
                    payment: { completed: false, status: 'pending' },
                    review: { completed: false, status: 'pending' },
                    approval: { completed: false, status: 'pending' }
                }
            };
            await db.collection('applications').insertOne(newApp);
            console.log(`✅ Created new application for user: ${uid}`);
            return res.json({ success: true, message: 'Application created and notifications updated' });
        }
        
        const result = await db.collection('applications').updateOne(
            { uid: uid },
            {
                $set: {
                    notifications: notifications || [],
                    updatedAt: new Date()
                }
            }
        );
        
        console.log(`✅ Notifications updated for user: ${uid}, matched: ${result.matchedCount}, modified: ${result.modifiedCount}`);
        res.json({ success: true, message: 'Notifications updated' });
    } catch (error) {
        console.error('Error updating notifications:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// USER ROUTES - MUST COME AFTER /api/users/notifications
// ============================================================
app.get('/api/users/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        const user = await db.collection('users').findOne({ uid: uid });
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/users/:uid/full', async (req, res) => {
    try {
        const { uid } = req.params;
        const user = await db.collection('users').findOne({ uid: uid });
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        const application = await db.collection('applications').findOne({ uid: uid });
        res.json({ success: true, user: user, application: application || null });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/users/:uid/documents', async (req, res) => {
    try {
        const { uid } = req.params;
        const application = await db.collection('applications').findOne({ uid: uid });
        if (!application) {
            return res.json({ success: true, documents: {} });
        }
        res.json({ success: true, documents: application.documents || {}, uploadHistory: application.uploadHistory || [] });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/users/:uid/exists', async (req, res) => {
    try {
        const { uid } = req.params;
        const user = await db.collection('users').findOne({ uid: uid });
        res.json({ success: true, exists: !!user, user: user || null });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.put('/api/users/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        const updateData = { ...req.body, updatedAt: new Date() };
        const result = await db.collection('users').updateOne(
            { uid: uid },
            { $set: updateData }
        );
        if (result.matchedCount === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        res.json({ success: true, message: 'User updated' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// OTHER USER API ENDPOINTS
// ============================================================
app.post('/api/users/documents', async (req, res) => {
    try {
        const { uid, docType, fileId, fileName, fileSize, fileType, fileUrl, status, uploadedAt } = req.body;
        if (!uid || !fileId || !docType) {
            return res.status(400).json({ success: false, message: 'uid, fileId, and docType are required' });
        }
        const user = await db.collection('users').findOne({ uid: uid });
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        let application = await db.collection('applications').findOne({ uid: uid });
        if (!application) {
            const newApp = {
                uid: uid,
                userId: uid,
                status: 'draft',
                progress: 0,
                currentStep: 'document_upload',
                personalInfo: {
                    name: user.name || 'Unknown',
                    email: user.email || '',
                    phone: user.phone || '',
                    countryOfInterest: user.countryOfInterest || ''
                },
                documents: {},
                payments: [],
                notifications: [],
                uploadHistory: [],
                paymentReceipt: null,
                createdAt: new Date(),
                updatedAt: new Date(),
                applicationStages: {
                    personal_info: { completed: true, status: 'completed', completedAt: new Date() },
                    document_upload: { completed: false, status: 'pending' },
                    payment: { completed: false, status: 'pending' },
                    review: { completed: false, status: 'pending' },
                    approval: { completed: false, status: 'pending' }
                }
            };
            await db.collection('applications').insertOne(newApp);
            application = newApp;
        }
        const docData = {
            fileId: fileId,
            fileName: fileName || 'Unknown',
            fileSize: fileSize || 0,
            fileType: fileType || 'application/octet-stream',
            fileUrl: fileUrl || '',
            status: status || 'pending_review',
            uploadedAt: uploadedAt || new Date().toISOString()
        };
        const updatePath = `documents.${docType}`;
        await db.collection('applications').updateOne(
            { uid: uid },
            {
                $set: { [updatePath]: docData, updatedAt: new Date() },
                $push: {
                    uploadHistory: {
                        filename: fileName || 'Unknown',
                        docType: docType,
                        timestamp: new Date().toISOString(),
                        status: 'submitted',
                        fileId: fileId,
                        fileUrl: fileUrl
                    }
                }
            }
        );
        res.json({ success: true, message: 'Document metadata saved successfully', document: docData });
    } catch (error) {
        console.error('❌ Error saving document metadata:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/users/documents/upsert', async (req, res) => {
    try {
        const { uid, docType, fileId, fileName, fileSize, fileType, fileUrl, status, uploadedAt } = req.body;
        if (!uid || !fileId || !docType) {
            return res.status(400).json({ success: false, message: 'uid, fileId, and docType are required' });
        }
        const docData = {
            fileId: fileId,
            fileName: fileName || 'Unknown',
            fileSize: fileSize || 0,
            fileType: fileType || 'application/octet-stream',
            fileUrl: fileUrl || '',
            status: status || 'pending_review',
            uploadedAt: uploadedAt || new Date().toISOString()
        };
        const updatePath = `documents.${docType}`;
        const result = await db.collection('applications').updateOne(
            { uid: uid },
            {
                $set: { [updatePath]: docData, updatedAt: new Date() },
                $push: {
                    uploadHistory: {
                        filename: fileName || 'Unknown',
                        docType: docType,
                        timestamp: new Date().toISOString(),
                        status: 'submitted',
                        fileId: fileId,
                        fileUrl: fileUrl
                    }
                }
            },
            { upsert: true }
        );
        res.json({ success: true, message: 'Document metadata saved successfully', document: docData, upserted: !!result.upsertedId });
    } catch (error) {
        console.error('❌ Error in upsert:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/users/application', async (req, res) => {
    try {
        const appData = req.body;
        if (!appData.uid) {
            return res.status(400).json({ success: false, message: 'uid is required' });
        }
        const existing = await db.collection('applications').findOne({ uid: appData.uid });
        if (existing) {
            await db.collection('applications').updateOne(
                { uid: appData.uid },
                { $set: { ...appData, updatedAt: new Date() } }
            );
        } else {
            appData.createdAt = new Date();
            appData.updatedAt = new Date();
            await db.collection('applications').insertOne(appData);
        }
        res.json({ success: true, message: 'Application saved' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.put('/api/users/application/update', async (req, res) => {
    try {
        const { uid, applicationStages, updatedAt } = req.body;
        if (!uid) {
            return res.status(400).json({ success: false, message: 'uid is required' });
        }
        const updateData = { updatedAt: new Date() };
        if (applicationStages) {
            updateData.applicationStages = applicationStages;
        }
        await db.collection('applications').updateOne(
            { uid: uid },
            { $set: updateData }
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating application stage:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// SAVE PAYMENT RECEIPT - FIXED
// ============================================================
app.post('/api/users/payment-receipt', async (req, res) => {
    try {
        const { uid, receiptUrl, receiptFileId, receiptFileName, uploadedAt, status, amount } = req.body;
        if (!uid || !receiptUrl) {
            return res.status(400).json({ success: false, message: 'uid and receiptUrl are required' });
        }
        
        let application = await db.collection('applications').findOne({ uid: uid });
        if (!application) {
            const user = await db.collection('users').findOne({ uid: uid });
            if (!user) {
                return res.status(404).json({ success: false, message: 'User not found' });
            }
            const newApp = {
                uid: uid,
                userId: uid,
                status: 'draft',
                progress: 0,
                currentStep: 'payment',
                personalInfo: {
                    name: user.name || 'Unknown',
                    email: user.email || '',
                    phone: user.phone || '',
                    countryOfInterest: user.countryOfInterest || ''
                },
                documents: {},
                payments: [],
                notifications: [],
                uploadHistory: [],
                paymentReceipt: null,
                createdAt: new Date(),
                updatedAt: new Date(),
                applicationStages: {
                    personal_info: { completed: true, status: 'completed', completedAt: new Date() },
                    document_upload: { completed: false, status: 'pending' },
                    payment: { completed: false, status: 'pending' },
                    review: { completed: false, status: 'pending' },
                    approval: { completed: false, status: 'pending' }
                }
            };
            await db.collection('applications').insertOne(newApp);
            application = newApp;
        }
        
        await db.collection('applications').updateOne(
            { uid: uid },
            {
                $pull: {
                    payments: { status: 'pending' }
                }
            }
        );
        
        const receiptData = {
            receiptUrl: receiptUrl,
            receiptFileId: receiptFileId,
            receiptFileName: receiptFileName || 'receipt',
            uploadedAt: uploadedAt || new Date().toISOString(),
            status: 'pending_verification',
            amount: amount || 0
        };
        
        await db.collection('applications').updateOne(
            { uid: uid },
            {
                $set: { 
                    paymentReceipt: receiptData, 
                    updatedAt: new Date(),
                    status: 'payment_pending'
                },
                $push: {
                    payments: {
                        amount: amount || 0,
                        status: 'pending',
                        description: `Payment receipt uploaded: $${(amount || 0).toFixed(2)}`,
                        receiptUrl: receiptUrl,
                        uploadedAt: uploadedAt || new Date().toISOString()
                    }
                }
            }
        );
        res.json({ success: true, message: 'Receipt saved successfully', receipt: receiptData });
    } catch (error) {
        console.error('Error saving receipt:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// ADMIN NOTIFICATIONS
// ============================================================
app.get('/api/admin/notifications', authenticateToken, async (req, res) => {
    try {
        const notifications = await db.collection('notifications').find({}).sort({ createdAt: -1 }).toArray();
        res.json({ success: true, notifications });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/notifications', authenticateToken, async (req, res) => {
    try {
        const { title, message, recipientType, priority, sender, senderEmail, specificEmail } = req.body;
        if (!title || !message) {
            return res.status(400).json({ success: false, message: 'Title and message are required' });
        }
        const notification = {
            title: title,
            message: message,
            recipientType: recipientType || 'all',
            priority: priority || 'normal',
            sender: sender || 'Admin',
            senderEmail: senderEmail || 'admin@globalimmigrationsc.com',
            read: false,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        if (specificEmail) {
            notification.specificEmail = specificEmail;
        }
        const result = await db.collection('notifications').insertOne(notification);
        const users = await db.collection('users').find({}).toArray();
        let recipientCount = 0;
        for (const user of users) {
            if (specificEmail && user.email !== specificEmail) continue;
            if (recipientType === 'applicants' && user.userType !== 'applicant') continue;
            if (recipientType === 'students' && user.userType !== 'student') continue;
            const userNotif = {
                id: result.insertedId,
                title: title,
                message: message,
                priority: priority || 'normal',
                sender: sender || 'Admin',
                read: false,
                createdAt: new Date().toISOString()
            };
            await db.collection('applications').updateOne(
                { uid: user.uid },
                { $push: { notifications: userNotif }, $set: { updatedAt: new Date() } }
            );
            recipientCount++;
        }
        res.json({ success: true, id: result.insertedId, notification: notification, recipientCount: recipientCount });
    } catch (error) {
        console.error('Error creating notification:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.put('/api/admin/notifications/:id/read', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db.collection('notifications').updateOne(
            { _id: new ObjectId(id) },
            { $set: { read: true, updatedAt: new Date() } }
        );
        await db.collection('applications').updateMany(
            { 'notifications.id': id },
            { $set: { 'notifications.$.read': true } }
        );
        if (result.matchedCount === 0) {
            return res.status(404).json({ success: false, message: 'Notification not found' });
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.delete('/api/admin/notifications/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db.collection('notifications').deleteOne({ _id: new ObjectId(id) });
        await db.collection('applications').updateMany(
            {},
            { $pull: { notifications: { id: id } } }
        );
        if (result.deletedCount === 0) {
            return res.status(404).json({ success: false, message: 'Notification not found' });
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// PAYMENT MANAGEMENT - ADMIN ENDPOINTS
// ============================================================
app.put('/api/admin/payments/confirm', authenticateToken, async (req, res) => {
    try {
        const { uid } = req.body;
        if (!uid) {
            return res.status(400).json({ success: false, message: 'uid is required' });
        }

        const application = await db.collection('applications').findOne({ uid: uid });
        if (!application) {
            return res.status(404).json({ success: false, message: 'Application not found' });
        }

        const receipt = application.paymentReceipt || {};
        const amount = receipt.amount || 0;

        const updatedReceipt = {
            ...receipt,
            status: 'verified',
            verifiedAt: new Date().toISOString(),
            verifiedBy: req.user?.email || 'admin'
        };

        const pendingPaymentIndex = application.payments?.findIndex(p => p.status === 'pending') || -1;
        
        let updateQuery = {
            $set: {
                paymentReceipt: updatedReceipt,
                status: 'payment_confirmed',
                updatedAt: new Date(),
                'applicationStages.payment': {
                    completed: true,
                    status: 'completed',
                    completedAt: new Date().toISOString()
                }
            }
        };

        if (pendingPaymentIndex !== -1) {
            const updatePath = `payments.${pendingPaymentIndex}`;
            updateQuery.$set[updatePath] = {
                amount: amount,
                status: 'completed',
                description: `Payment confirmed by admin. Amount: $${amount.toFixed(2)}`,
                receiptUrl: receipt.receiptUrl || '',
                confirmedAt: new Date().toISOString(),
                confirmedBy: req.user?.email || 'admin'
            };
        } else {
            updateQuery.$push = {
                payments: {
                    amount: amount,
                    status: 'completed',
                    description: `Payment confirmed by admin. Amount: $${amount.toFixed(2)}`,
                    receiptUrl: receipt.receiptUrl || '',
                    confirmedAt: new Date().toISOString(),
                    confirmedBy: req.user?.email || 'admin'
                }
            };
        }

        await db.collection('applications').updateOne(
            { uid: uid },
            updateQuery
        );

        console.log(`✅ Payment confirmed for user: ${uid} - Amount: $${amount.toFixed(2)}`);
        res.json({ success: true, message: 'Payment confirmed successfully', amount: amount });
    } catch (error) {
        console.error('Error confirming payment:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.put('/api/admin/payments/pending', authenticateToken, async (req, res) => {
    try {
        const { uid } = req.body;
        if (!uid) {
            return res.status(400).json({ success: false, message: 'uid is required' });
        }

        const application = await db.collection('applications').findOne({ uid: uid });
        if (!application) {
            return res.status(404).json({ success: false, message: 'Application not found' });
        }

        const receipt = application.paymentReceipt || {};
        const amount = receipt.amount || 0;

        const updatedReceipt = {
            ...receipt,
            status: 'pending_verification',
            pendingAt: new Date().toISOString()
        };

        await db.collection('applications').updateOne(
            { uid: uid },
            {
                $pull: {
                    payments: { status: { $in: ['completed', 'rejected'] } }
                }
            }
        );

        const hasPending = application.payments?.some(p => p.status === 'pending');
        
        let updateQuery = {
            $set: {
                paymentReceipt: updatedReceipt,
                status: 'payment_pending',
                updatedAt: new Date()
            }
        };

        if (!hasPending && receipt.receiptUrl) {
            updateQuery.$push = {
                payments: {
                    amount: amount,
                    status: 'pending',
                    description: `Payment pending verification. Amount: $${amount.toFixed(2)}`,
                    receiptUrl: receipt.receiptUrl || '',
                    pendingAt: new Date().toISOString()
                }
            };
        }

        await db.collection('applications').updateOne(
            { uid: uid },
            updateQuery
        );

        console.log(`⏳ Payment marked as pending for user: ${uid} - Amount: $${amount.toFixed(2)}`);
        res.json({ success: true, message: 'Payment marked as pending', amount: amount });
    } catch (error) {
        console.error('Error marking payment pending:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.put('/api/admin/payments/due', authenticateToken, async (req, res) => {
    try {
        const { uid } = req.body;
        if (!uid) {
            return res.status(400).json({ success: false, message: 'uid is required' });
        }

        const application = await db.collection('applications').findOne({ uid: uid });
        if (!application) {
            return res.status(404).json({ success: false, message: 'Application not found' });
        }

        const receipt = application.paymentReceipt || {};
        const updatedReceipt = {
            ...receipt,
            status: 'due'
        };

        await db.collection('applications').updateOne(
            { uid: uid },
            {
                $set: {
                    paymentReceipt: updatedReceipt,
                    status: 'draft',
                    updatedAt: new Date()
                }
            }
        );

        console.log(`💳 Payment marked as due for user: ${uid}`);
        res.json({ success: true, message: 'Payment marked as due' });
    } catch (error) {
        console.error('Error marking payment due:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.put('/api/admin/payments/reject', authenticateToken, async (req, res) => {
    try {
        const { uid, reason } = req.body;
        if (!uid) {
            return res.status(400).json({ success: false, message: 'uid is required' });
        }

        const application = await db.collection('applications').findOne({ uid: uid });
        if (!application) {
            return res.status(404).json({ success: false, message: 'Application not found' });
        }

        const receipt = application.paymentReceipt || {};
        const amount = receipt.amount || 0;

        const updatedReceipt = {
            ...receipt,
            status: 'rejected',
            rejectionReason: reason || 'Invalid receipt',
            rejectedAt: new Date().toISOString(),
            rejectedBy: req.user?.email || 'admin'
        };

        await db.collection('applications').updateOne(
            { uid: uid },
            {
                $pull: {
                    payments: { status: { $in: ['pending', 'completed'] } }
                }
            }
        );

        await db.collection('applications').updateOne(
            { uid: uid },
            {
                $set: {
                    paymentReceipt: updatedReceipt,
                    status: 'payment_rejected',
                    updatedAt: new Date()
                },
                $push: {
                    payments: {
                        amount: amount,
                        status: 'rejected',
                        description: `Payment rejected. Reason: ${reason || 'Invalid receipt'}. Amount: $${amount.toFixed(2)}`,
                        receiptUrl: receipt.receiptUrl || '',
                        rejectedAt: new Date().toISOString(),
                        rejectedBy: req.user?.email || 'admin'
                    }
                }
            }
        );

        console.log(`❌ Payment rejected for user: ${uid} - Amount: $${amount.toFixed(2)}`);
        res.json({ success: true, message: 'Payment rejected successfully' });
    } catch (error) {
        console.error('Error rejecting payment:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.delete('/api/admin/payments/delete', authenticateToken, async (req, res) => {
    try {
        const { uid } = req.body;
        if (!uid) {
            return res.status(400).json({ success: false, message: 'uid is required' });
        }

        const application = await db.collection('applications').findOne({ uid: uid });
        if (!application) {
            return res.status(404).json({ success: false, message: 'Application not found' });
        }

        await db.collection('applications').updateOne(
            { uid: uid },
            {
                $set: {
                    paymentReceipt: null,
                    status: 'draft',
                    updatedAt: new Date()
                },
                $pull: {
                    payments: { status: { $in: ['pending', 'completed', 'rejected'] } }
                }
            }
        );

        await db.collection('applications').updateOne(
            { uid: uid },
            {
                $set: {
                    'applicationStages.payment': {
                        completed: false,
                        status: 'pending'
                    },
                    updatedAt: new Date()
                }
            }
        );

        console.log(`🗑️ Payment record deleted for user: ${uid}`);
        res.json({ success: true, message: 'Payment record deleted successfully' });
    } catch (error) {
        console.error('Error deleting payment:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// SERVE STATIC FILES - AT THE VERY END
// ============================================================
app.use('/portal', express.static(path.join(__dirname, 'portal')));
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================================
// START SERVER
// ============================================================
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📍 URL: https://gisc-app-production.up.railway.app`);
});
