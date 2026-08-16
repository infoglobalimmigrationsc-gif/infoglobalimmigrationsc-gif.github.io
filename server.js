// server.js - GISC APPLICANT PORTAL 2.0 COMPLETE
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
        
        // Create collections if they don't exist
        const collections = await db.listCollections().toArray();
        const collectionNames = collections.map(c => c.name);
        
        const requiredCollections = ['opportunities', 'scholarships', 'universities', 'programmes', 'service_requests', 'recommendations'];
        for (const col of requiredCollections) {
            if (!collectionNames.includes(col)) {
                await db.createCollection(col);
                console.log(`✅ Created collection: ${col}`);
            }
        }
        
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

        const user = await db.collection('users').findOne({ email: email });
        if (!user) {
            return res.status(404).json({ success: false, message: 'No account found with this email address.' });
        }

        const crypto = require('crypto');
        const resetToken = crypto.randomBytes(32).toString('hex');
        const tokenExpiry = new Date();
        tokenExpiry.setHours(tokenExpiry.getHours() + 1);

        await db.collection('users').updateOne(
            { email: email },
            { 
                $set: { 
                    resetToken: resetToken,
                    resetTokenExpiry: tokenExpiry
                }
            }
        );

        const resetLink = `https://globalimmigrationsclr.com/portal/reset-password.html?token=${resetToken}`;
        console.log(`🔗 🔗 🔗 RESET LINK FOR ${email}: ${resetLink} 🔗 🔗 🔗`);

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

        const hashedPassword = await bcrypt.hash(newPassword, 10);

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
        version: '2.0.0',
        status: 'running',
        endpoints: {
            admin_login: '/api/admin/login (POST)',
            upload: '/api/upload (POST)',
            download: '/api/file/:id (GET)',
            health: '/api/health (GET)',
            opportunities: '/api/opportunities (GET)',
            scholarships: '/api/scholarships (GET)',
            universities: '/api/universities (GET)',
            programmes: '/api/programmes (GET)'
        }
    });
});

// ============================================================
// ADMIN API ENDPOINTS (EXISTING - PRESERVED)
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

// ============================================================
// ADMIN BLOG ROUTES (EXISTING - PRESERVED)
// ============================================================
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

// ============================================================
// PUBLIC BLOG ROUTE (No auth required)
// ============================================================
app.get('/api/blogs', async (req, res) => {
    try {
        const blogs = await db.collection('blogs')
            .find({ status: 'published' })
            .sort({ createdAt: -1 })
            .toArray();
        res.json({ success: true, blogs });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/blogs/:id', async (req, res) => {
    try {
        const blog = await db.collection('blogs').findOne({ 
            _id: new ObjectId(req.params.id),
            status: 'published'
        });
        if (!blog) {
            return res.status(404).json({ success: false, message: 'Blog not found' });
        }
        res.json({ success: true, blog });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// ADMIN CONTACT ROUTES (EXISTING - PRESERVED)
// ============================================================
app.get('/api/admin/contacts', authenticateToken, async (req, res) => {
    try {
        const contacts = await db.collection('contacts').find({}).sort({ createdAt: -1 }).toArray();
        res.json({ success: true, contacts });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.patch('/api/admin/contacts/:id/status', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        
        if (!status) {
            return res.status(400).json({ success: false, message: 'Status is required' });
        }
        
        const validStatuses = ['new', 'read', 'replied', 'archived'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }
        
        const result = await db.collection('contacts').updateOne(
            { _id: new ObjectId(id) },
            { 
                $set: { 
                    status: status,
                    updatedAt: new Date()
                }
            }
        );
        
        if (result.matchedCount === 0) {
            return res.status(404).json({ success: false, message: 'Contact not found' });
        }
        
        console.log(`📩 Contact ${id} status updated to: ${status}`);
        res.json({ success: true, message: 'Status updated successfully' });
        
    } catch (error) {
        console.error('Error updating contact status:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/contacts/:id/reply', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { message, subject } = req.body;
        
        if (!message) {
            return res.status(400).json({ success: false, message: 'Reply message is required' });
        }
        
        const contact = await db.collection('contacts').findOne({ _id: new ObjectId(id) });
        if (!contact) {
            return res.status(404).json({ success: false, message: 'Contact not found' });
        }
        
        await db.collection('contacts').updateOne(
            { _id: new ObjectId(id) },
            {
                $set: {
                    status: 'replied',
                    repliedAt: new Date(),
                    replyMessage: message,
                    replySubject: subject || 'Re: Your inquiry to Global Immigration SC',
                    repliedBy: req.user?.email || 'admin',
                    updatedAt: new Date()
                }
            }
        );
        
        console.log(`📧 Reply sent to ${contact.email} for contact ${id}`);
        res.json({ 
            success: true, 
            message: 'Reply sent successfully',
            reply: {
                to: contact.email,
                subject: subject || 'Re: Your inquiry to Global Immigration SC',
                message: message
            }
        });
        
    } catch (error) {
        console.error('Error sending reply:', error);
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
// CONTACT - OPTIONS Preflight (CORS)
// ============================================================
app.options('/api/contacts', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
    res.sendStatus(200);
});

// ============================================================
// PUBLIC CONTACT SUBMISSION (No auth required)
// ============================================================
app.post('/api/contacts', async (req, res) => {
    try {
        const { name, email, phone, country, interest, message, form_type } = req.body;
        
        if (!name || !email || !phone || !country || !interest || !message) {
            return res.status(400).json({ 
                success: false, 
                message: 'All fields are required: name, email, phone, country, interest, message' 
            });
        }
        
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ success: false, message: 'Invalid email format' });
        }
        
        const contactData = {
            name: name.trim(),
            email: email.trim().toLowerCase(),
            phone: phone.trim(),
            country: country.trim(),
            interest: interest.trim(),
            message: message.trim(),
            form_type: form_type || 'contact_form',
            status: 'new',
            createdAt: new Date(),
            updatedAt: new Date()
        };
        
        const result = await db.collection('contacts').insertOne(contactData);
        
        console.log(`📩 New contact submission from ${name} (${email})`);
        
        res.json({ 
            success: true, 
            message: 'Your message has been sent successfully! We will contact you shortly.',
            contact: { ...contactData, _id: result.insertedId }
        });
        
    } catch (error) {
        console.error('❌ Error saving contact:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// USER API ENDPOINTS (EXISTING - PRESERVED)
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
            // New fields for 2.0
            highest_qualification: '',
            field_of_study: '',
            gpa: null,
            graduation_year: null,
            intended_programme: '',
            degree_level: '',
            preferred_intake: '',
            education_budget: '',
            scholarship_required: false,
            fully_funded_preferred: false,
            partial_scholarship_acceptable: false,
            student_loan_interest: false,
            work_experience: '',
            occupation: '',
            career_goal: '',
            profile_completion: 0,
            recommendations_generated_at: null,
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
            service_requests: [],
            recommendation_ids: [],
            cost_estimates: null,
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
                service_requests: [],
                recommendation_ids: [],
                cost_estimates: null,
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
        
        // Calculate profile completion
        const fields = ['name', 'phone', 'citizenship', 'countryOfInterest', 'serviceType',
                       'highest_qualification', 'field_of_study', 'gpa', 'graduation_year',
                       'intended_programme', 'degree_level', 'preferred_intake', 'education_budget'];
        let filled = 0;
        for (const field of fields) {
            if (updateData[field] && updateData[field] !== '' && updateData[field] !== null && updateData[field] !== false) {
                filled++;
            }
        }
        updateData.profile_completion = Math.round((filled / fields.length) * 100);
        
        const result = await db.collection('users').updateOne(
            { uid: uid },
            { $set: updateData }
        );
        if (result.matchedCount === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        res.json({ success: true, message: 'User updated', profile_completion: updateData.profile_completion });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// OTHER USER API ENDPOINTS (EXISTING - PRESERVED)
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
                service_requests: [],
                recommendation_ids: [],
                cost_estimates: null,
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

app.post('/api/users/documents/multiple', async (req, res) => {
    try {
        const { uid, docType, document } = req.body;
        
        if (!uid || !docType || !document) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }
        
        const collection = db.collection('applications');
        
        let application = await collection.findOne({ uid: uid });
        if (!application) {
            application = await collection.findOne({ userId: uid });
            if (!application) {
                return res.status(404).json({ success: false, message: 'Application not found for user' });
            }
        }
        
        let currentDocs = application.documents || {};
        let existing = currentDocs[docType] || [];
        
        if (!Array.isArray(existing)) {
            existing = [];
        }
        
        existing.push(document);
        currentDocs[docType] = existing;
        
        await collection.updateOne(
            { _id: application._id },
            { 
                $set: { 
                    documents: currentDocs, 
                    updatedAt: new Date().toISOString() 
                },
                $push: {
                    uploadHistory: {
                        filename: document.fileName || 'Unknown',
                        docType: docType,
                        timestamp: new Date().toISOString(),
                        status: 'submitted',
                        fileId: document.fileId,
                        fileUrl: document.fileUrl
                    }
                }
            }
        );
        
        console.log(`✅ Added document to ${docType} for user ${uid}. Total: ${existing.length} files`);
        
        res.json({ success: true, message: 'Document added successfully', count: existing.length });
    } catch (error) {
        console.error('Error adding multiple document:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

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
                service_requests: [],
                recommendation_ids: [],
                cost_estimates: null,
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
// ADMIN NOTIFICATIONS (EXISTING - PRESERVED)
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
// PAYMENT MANAGEMENT - ADMIN ENDPOINTS (EXISTING - PRESERVED)
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
// ============================================================
// NEW API ENDPOINTS FOR PORTAL 2.0
// ============================================================
// ============================================================

// ============================================================
// OPPORTUNITIES API - PUBLIC
// ============================================================
app.get('/api/opportunities', async (req, res) => {
    try {
        const { country, degree_level, field, status, limit } = req.query;
        const query = { status: 'published' };
        if (country) query.country = country;
        if (degree_level) query.degree_level = degree_level;
        if (field) query.field = { $regex: field, $options: 'i' };
        if (status) query.status = status;
        
        let cursor = db.collection('opportunities').find(query).sort({ created_at: -1 });
        if (limit) cursor = cursor.limit(parseInt(limit));
        
        const opportunities = await cursor.toArray();
        res.json({ success: true, opportunities, count: opportunities.length });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/opportunities/:id', async (req, res) => {
    try {
        const opportunity = await db.collection('opportunities').findOne({ _id: new ObjectId(req.params.id) });
        if (!opportunity) return res.status(404).json({ success: false, message: 'Opportunity not found' });
        res.json({ success: true, opportunity });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// SCHOLARSHIPS API - PUBLIC
// ============================================================
app.get('/api/scholarships', async (req, res) => {
    try {
        const { country, degree_level, field, status, limit } = req.query;
        const query = { status: 'open' };
        if (country) query.country = country;
        if (degree_level) query.degree_level = degree_level;
        if (field) query.field = { $regex: field, $options: 'i' };
        if (status) query.status = status;
        
        let cursor = db.collection('scholarships').find(query).sort({ deadline: 1 });
        if (limit) cursor = cursor.limit(parseInt(limit));
        
        const scholarships = await cursor.toArray();
        res.json({ success: true, scholarships, count: scholarships.length });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/scholarships/:id', async (req, res) => {
    try {
        const scholarship = await db.collection('scholarships').findOne({ _id: new ObjectId(req.params.id) });
        if (!scholarship) return res.status(404).json({ success: false, message: 'Scholarship not found' });
        res.json({ success: true, scholarship });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// UNIVERSITIES API - PUBLIC
// ============================================================
app.get('/api/universities', async (req, res) => {
    try {
        const { country, partner_status, limit } = req.query;
        const query = { status: 'active' };
        if (country) query.country = country;
        if (partner_status) query.partner_status = partner_status;
        
        let cursor = db.collection('universities').find(query).sort({ name: 1 });
        if (limit) cursor = cursor.limit(parseInt(limit));
        
        const universities = await cursor.toArray();
        res.json({ success: true, universities, count: universities.length });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/universities/:id', async (req, res) => {
    try {
        const university = await db.collection('universities').findOne({ _id: new ObjectId(req.params.id) });
        if (!university) return res.status(404).json({ success: false, message: 'University not found' });
        res.json({ success: true, university });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// PROGRAMMES API - PUBLIC
// ============================================================
app.get('/api/programmes', async (req, res) => {
    try {
        const { country, degree, field, institution, limit } = req.query;
        const query = { status: 'active' };
        if (country) query.country = country;
        if (degree) query.degree = degree;
        if (field) query.field = { $regex: field, $options: 'i' };
        if (institution) query.institution = { $regex: institution, $options: 'i' };
        
        let cursor = db.collection('programmes').find(query).sort({ name: 1 });
        if (limit) cursor = cursor.limit(parseInt(limit));
        
        const programmes = await cursor.toArray();
        res.json({ success: true, programmes, count: programmes.length });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/programmes/:id', async (req, res) => {
    try {
        const programme = await db.collection('programmes').findOne({ _id: new ObjectId(req.params.id) });
        if (!programme) return res.status(404).json({ success: false, message: 'Programme not found' });
        res.json({ success: true, programme });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// COST ESTIMATE
// ============================================================
app.get('/api/cost-estimate/:opportunityId', async (req, res) => {
    try {
        const opportunity = await db.collection('opportunities').findOne({ _id: new ObjectId(req.params.opportunityId) });
        if (!opportunity) return res.status(404).json({ success: false, message: 'Opportunity not found' });
        
        const estimate = {
            tuition: opportunity.tuition || 0,
            registration_fee: 0,
            scholarship_deduction: opportunity.scholarship_amount || 0,
            accommodation: opportunity.accommodation_cost || 0,
            living_expenses: opportunity.estimated_living_cost || 0,
            health_insurance: 0,
            visa_fee: 0,
            flight_estimate: 0,
            gisc_service_fee: 0,
            other_fees: 0,
            currency: opportunity.currency || 'USD',
            calculated_at: new Date(),
            source_date: opportunity.source_date || null
        };
        
        estimate.total = estimate.tuition + estimate.registration_fee + estimate.accommodation +
                        estimate.living_expenses + estimate.health_insurance + estimate.visa_fee +
                        estimate.flight_estimate + estimate.gisc_service_fee + estimate.other_fees -
                        estimate.scholarship_deduction;
        
        res.json({ success: true, estimate, opportunity: { name: opportunity.programme, institution: opportunity.institution, country: opportunity.country } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// SERVICE REQUESTS - PUBLIC
// ============================================================
app.post('/api/service-requests', async (req, res) => {
    try {
        const { uid, service_category, service_name, description } = req.body;
        if (!uid || !service_category || !service_name) {
            return res.status(400).json({ success: false, message: 'uid, service_category, and service_name are required' });
        }
        
        const user = await db.collection('users').findOne({ uid: uid });
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        
        const serviceRequest = {
            uid: uid,
            user_name: user.name || 'Unknown',
            user_email: user.email || '',
            service_category: service_category,
            service_name: service_name,
            description: description || '',
            status: 'pending',
            price: 0,
            created_at: new Date(),
            updated_at: new Date()
        };
        
        const result = await db.collection('service_requests').insertOne(serviceRequest);
        
        await db.collection('applications').updateOne(
            { uid: uid },
            { $push: { service_requests: result.insertedId }, $set: { updatedAt: new Date() } }
        );
        
        const notification = {
            id: result.insertedId.toString(),
            title: 'Service Request Submitted',
            message: `Your request for "${service_name}" has been submitted and is pending review.`,
            read: false,
            createdAt: new Date().toISOString()
        };
        await db.collection('applications').updateOne(
            { uid: uid },
            { $push: { notifications: notification } }
        );
        
        res.json({ success: true, message: 'Service request submitted successfully', id: result.insertedId });
    } catch (error) {
        console.error('Error creating service request:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/service-requests/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        const requests = await db.collection('service_requests')
            .find({ uid: uid })
            .sort({ created_at: -1 })
            .toArray();
        res.json({ success: true, requests, count: requests.length });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// RECOMMENDATIONS - PUBLIC
// ============================================================
app.post('/api/recommendations/generate', async (req, res) => {
    try {
        const { uid } = req.body;
        if (!uid) return res.status(400).json({ success: false, message: 'uid is required' });
        
        const user = await db.collection('users').findOne({ uid: uid });
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        
        const opportunities = await db.collection('opportunities')
            .find({ status: 'published' })
            .toArray();
        
        if (opportunities.length === 0) {
            return res.json({ success: true, recommendations: [], message: 'No opportunities available' });
        }
        
        const recommendations = [];
        
        for (const opp of opportunities) {
            // Eligibility filter
            let eligible = true;
            if (opp.degree_level === 'Master' && !user.highest_qualification) eligible = false;
            if (opp.degree_level === 'PhD' && user.highest_qualification !== 'Master\'s Degree' && user.highest_qualification !== 'PhD') eligible = false;
            
            if (!eligible) continue;
            
            // Calculate matches
            let academicMatch = 0;
            if (user.field_of_study && opp.field) {
                const userFields = user.field_of_study.toLowerCase().split(/[, ]+/);
                const oppFields = opp.field.toLowerCase().split(/[, ]+/);
                const match = userFields.some(f => oppFields.some(o => f.includes(o) || o.includes(f)));
                if (match) academicMatch = 0.8;
                else academicMatch = 0.3;
            } else {
                academicMatch = 0.5;
            }
            
            let programmeMatch = 0;
            if (user.intended_programme && opp.programme) {
                const p1 = user.intended_programme.toLowerCase();
                const p2 = opp.programme.toLowerCase();
                if (p1.includes(p2) || p2.includes(p1)) programmeMatch = 1;
                else {
                    const words1 = p1.split(/[, ]+/);
                    const words2 = p2.split(/[, ]+/);
                    let matches = 0;
                    for (const w of words1) {
                        if (w.length > 2 && words2.some(w2 => w2.includes(w) || w.includes(w2))) matches++;
                    }
                    programmeMatch = Math.min(matches / Math.max(words1.length, 1), 1);
                }
            } else {
                programmeMatch = 0.4;
            }
            
            let financialMatch = 0;
            const budgetMap = {
                'under_2000': 2000,
                '2000_5000': 5000,
                '5000_10000': 10000,
                '10000_20000': 20000,
                '20000_plus': 30000
            };
            const budget = budgetMap[user.education_budget] || 10000;
            const totalCost = (opp.tuition || 0) + (opp.estimated_living_cost || 0);
            if (totalCost <= budget) financialMatch = 1;
            else if (totalCost <= budget * 1.3) financialMatch = 0.7;
            else if (totalCost <= budget * 1.6) financialMatch = 0.4;
            else financialMatch = 0.2;
            
            let scholarshipMatch = 0;
            if (user.scholarship_required) {
                if (opp.scholarship_type === 'full') scholarshipMatch = 1;
                else if (opp.scholarship_type === 'partial') scholarshipMatch = 0.7;
                else if (opp.scholarship_type === 'tuition_waiver') scholarshipMatch = 0.5;
                else scholarshipMatch = 0.1;
            } else {
                scholarshipMatch = opp.scholarship_type && opp.scholarship_type !== 'none' ? 0.5 : 0.3;
            }
            
            let countryMatch = 0;
            if (user.countryOfInterest && opp.country) {
                if (user.countryOfInterest === opp.country) countryMatch = 1;
                else if (user.open_to_other_countries) countryMatch = 0.5;
                else countryMatch = 0.2;
            } else {
                countryMatch = 0.5;
            }
            
            let intakeMatch = 0;
            if (user.preferred_intake && opp.intake) {
                const pIntake = user.preferred_intake.toLowerCase();
                const oIntake = opp.intake.toLowerCase();
                if (pIntake.includes(oIntake) || oIntake.includes(pIntake)) intakeMatch = 1;
                else intakeMatch = 0.3;
            } else {
                intakeMatch = 0.5;
            }
            
            const weights = {
                academic: 0.30,
                programme: 0.20,
                financial: 0.20,
                scholarship: 0.15,
                country: 0.10,
                intake: 0.05
            };
            
            const totalScore = (academicMatch * weights.academic) +
                              (programmeMatch * weights.programme) +
                              (financialMatch * weights.financial) +
                              (scholarshipMatch * weights.scholarship) +
                              (countryMatch * weights.country) +
                              (intakeMatch * weights.intake);
            
            // Generate explanation
            const reasons = [];
            if (academicMatch > 0.7) reasons.push('Your academic background matches the programme requirements');
            else if (academicMatch > 0.4) reasons.push('Your academic background partially matches the programme requirements');
            
            if (programmeMatch > 0.7) reasons.push('The programme aligns with your stated interests');
            else if (programmeMatch > 0.4) reasons.push('The programme partially aligns with your interests');
            
            if (financialMatch > 0.7) reasons.push('The estimated costs are within your stated budget');
            else if (financialMatch > 0.4) reasons.push('The estimated costs are slightly above your budget');
            
            if (scholarshipMatch > 0.7) reasons.push('The scholarship opportunities match your needs');
            else if (scholarshipMatch > 0.4) reasons.push('There are available scholarship opportunities');
            
            if (countryMatch > 0.7) reasons.push('The country matches your preferences');
            
            let category;
            if (totalScore >= 0.80) category = 'strong';
            else if (totalScore >= 0.65) category = 'good';
            else if (totalScore >= 0.50) category = 'possible';
            else category = 'weak';
            
            if (category === 'strong' || category === 'good') {
                recommendations.push({
                    opportunity_id: opp._id,
                    match_score: Math.round(totalScore * 100),
                    match_category: category,
                    match_details: {
                        academic_match: Math.round(academicMatch * 100),
                        programme_match: Math.round(programmeMatch * 100),
                        financial_match: Math.round(financialMatch * 100),
                        scholarship_match: Math.round(scholarshipMatch * 100),
                        country_match: Math.round(countryMatch * 100),
                        intake_match: Math.round(intakeMatch * 100)
                    },
                    reason: reasons.join('. ') || 'This opportunity matches your profile.',
                    viewed: false,
                    applied: false,
                    created_at: new Date()
                });
            }
        }
        
        recommendations.sort((a, b) => b.match_score - a.match_score);
        
        await db.collection('recommendations').deleteMany({ uid: uid });
        if (recommendations.length > 0) {
            await db.collection('recommendations').insertMany(
                recommendations.map(r => ({ ...r, uid: uid, updated_at: new Date() }))
            );
            
            await db.collection('users').updateOne(
                { uid: uid },
                { $set: { recommendations_generated_at: new Date() } }
            );
        }
        
        res.json({
            success: true,
            recommendations: recommendations,
            count: recommendations.length,
            message: recommendations.length > 0 ? 'Recommendations generated successfully' : 'No strong matches found'
        });
    } catch (error) {
        console.error('Error generating recommendations:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/recommendations/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        const { include_all } = req.query;
        
        const query = { uid: uid };
        if (!include_all || include_all === 'false') {
            query.match_category = { $in: ['strong', 'good'] };
        }
        
        const recommendations = await db.collection('recommendations')
            .find(query)
            .sort({ match_score: -1 })
            .toArray();
        
        const enriched = [];
        for (const rec of recommendations) {
            const opp = await db.collection('opportunities').findOne({ _id: rec.opportunity_id });
            if (opp) {
                enriched.push({
                    ...rec,
                    opportunity: opp
                });
            }
        }
        
        res.json({ success: true, recommendations: enriched, count: enriched.length });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// ADMIN API - OPPORTUNITIES (NEW)
// ============================================================
app.post('/api/admin/opportunities', authenticateToken, async (req, res) => {
    try {
        const opportunity = { ...req.body, status: req.body.status || 'draft', created_at: new Date(), updated_at: new Date() };
        const result = await db.collection('opportunities').insertOne(opportunity);
        res.json({ success: true, id: result.insertedId, opportunity });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.put('/api/admin/opportunities/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = { ...req.body, updated_at: new Date() };
        delete updateData._id;
        delete updateData.created_at;
        
        const result = await db.collection('opportunities').updateOne(
            { _id: new ObjectId(id) },
            { $set: updateData }
        );
        if (result.matchedCount === 0) return res.status(404).json({ success: false, message: 'Opportunity not found' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.delete('/api/admin/opportunities/:id', authenticateToken, async (req, res) => {
    try {
        const result = await db.collection('opportunities').deleteOne({ _id: new ObjectId(req.params.id) });
        if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Opportunity not found' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// ADMIN API - SCHOLARSHIPS (NEW)
// ============================================================
app.post('/api/admin/scholarships', authenticateToken, async (req, res) => {
    try {
        const scholarship = { ...req.body, status: req.body.status || 'open', created_at: new Date(), updated_at: new Date() };
        const result = await db.collection('scholarships').insertOne(scholarship);
        res.json({ success: true, id: result.insertedId, scholarship });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.put('/api/admin/scholarships/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = { ...req.body, updated_at: new Date() };
        delete updateData._id;
        delete updateData.created_at;
        
        const result = await db.collection('scholarships').updateOne(
            { _id: new ObjectId(id) },
            { $set: updateData }
        );
        if (result.matchedCount === 0) return res.status(404).json({ success: false, message: 'Scholarship not found' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.delete('/api/admin/scholarships/:id', authenticateToken, async (req, res) => {
    try {
        const result = await db.collection('scholarships').deleteOne({ _id: new ObjectId(req.params.id) });
        if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Scholarship not found' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// ADMIN API - UNIVERSITIES (NEW)
// ============================================================
app.post('/api/admin/universities', authenticateToken, async (req, res) => {
    try {
        const university = { ...req.body, status: req.body.status || 'active', created_at: new Date(), updated_at: new Date() };
        const result = await db.collection('universities').insertOne(university);
        res.json({ success: true, id: result.insertedId, university });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.put('/api/admin/universities/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = { ...req.body, updated_at: new Date() };
        delete updateData._id;
        delete updateData.created_at;
        
        const result = await db.collection('universities').updateOne(
            { _id: new ObjectId(id) },
            { $set: updateData }
        );
        if (result.matchedCount === 0) return res.status(404).json({ success: false, message: 'University not found' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.delete('/api/admin/universities/:id', authenticateToken, async (req, res) => {
    try {
        const result = await db.collection('universities').deleteOne({ _id: new ObjectId(req.params.id) });
        if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'University not found' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// ADMIN API - PROGRAMMES (NEW)
// ============================================================
app.post('/api/admin/programmes', authenticateToken, async (req, res) => {
    try {
        const programme = { ...req.body, status: req.body.status || 'active', created_at: new Date(), updated_at: new Date() };
        const result = await db.collection('programmes').insertOne(programme);
        res.json({ success: true, id: result.insertedId, programme });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.put('/api/admin/programmes/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = { ...req.body, updated_at: new Date() };
        delete updateData._id;
        delete updateData.created_at;
        
        const result = await db.collection('programmes').updateOne(
            { _id: new ObjectId(id) },
            { $set: updateData }
        );
        if (result.matchedCount === 0) return res.status(404).json({ success: false, message: 'Programme not found' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.delete('/api/admin/programmes/:id', authenticateToken, async (req, res) => {
    try {
        const result = await db.collection('programmes').deleteOne({ _id: new ObjectId(req.params.id) });
        if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Programme not found' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// ADMIN API - SERVICE REQUESTS (NEW)
// ============================================================
app.get('/api/admin/service-requests', authenticateToken, async (req, res) => {
    try {
        const { status } = req.query;
        const query = {};
        if (status) query.status = status;
        
        const requests = await db.collection('service_requests')
            .find(query)
            .sort({ created_at: -1 })
            .toArray();
        res.json({ success: true, requests, count: requests.length });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.put('/api/admin/service-requests/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        if (!status) return res.status(400).json({ success: false, message: 'Status is required' });
        
        const validStatuses = ['pending', 'in_review', 'approved', 'completed', 'rejected'];
        if (!validStatuses.includes(status)) return res.status(400).json({ success: false, message: 'Invalid status' });
        
        const result = await db.collection('service_requests').updateOne(
            { _id: new ObjectId(id) },
            { $set: { status: status, updated_at: new Date() } }
        );
        if (result.matchedCount === 0) return res.status(404).json({ success: false, message: 'Service request not found' });
        res.json({ success: true, message: 'Service request updated' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.delete('/api/admin/service-requests/:id', authenticateToken, async (req, res) => {
    try {
        const result = await db.collection('service_requests').deleteOne({ _id: new ObjectId(req.params.id) });
        if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Service request not found' });
        res.json({ success: true });
    } catch (error) {
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
    console.log(`📚 New API Endpoints added for Portal 2.0:
    - GET  /api/opportunities
    - GET  /api/opportunities/:id
    - GET  /api/scholarships
    - GET  /api/scholarships/:id
    - GET  /api/universities
    - GET  /api/universities/:id
    - GET  /api/programmes
    - GET  /api/programmes/:id
    - GET  /api/cost-estimate/:opportunityId
    - POST /api/service-requests
    - GET  /api/service-requests/:uid
    - POST /api/recommendations/generate
    - GET  /api/recommendations/:uid
    - POST /api/admin/opportunities
    - PUT  /api/admin/opportunities/:id
    - DELETE /api/admin/opportunities/:id
    - POST /api/admin/scholarships
    - PUT  /api/admin/scholarships/:id
    - DELETE /api/admin/scholarships/:id
    - POST /api/admin/universities
    - PUT  /api/admin/universities/:id
    - DELETE /api/admin/universities/:id
    - POST /api/admin/programmes
    - PUT  /api/admin/programmes/:id
    - DELETE /api/admin/programmes/:id
    - GET  /api/admin/service-requests
    - PUT  /api/admin/service-requests/:id
    - DELETE /api/admin/service-requests/:id`);
});
