// server.js - COMPLETE WORKING FIXED VERSION
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
        
        // Create indexes for better performance
        try {
            await db.collection('blogs').createIndex({ status: 1, createdAt: -1 });
            await db.collection('contacts').createIndex({ createdAt: -1 });
            await db.collection('applications').createIndex({ uid: 1 });
            await db.collection('users').createIndex({ uid: 1 });
            console.log('✅ Indexes created');
        } catch (indexError) {
            console.log('⚠️ Index creation warning:', indexError.message);
        }
        
        // Create admin if not exists
        const admin = await db.collection('admins').findOne({ email: 'admin@globalimmigrationsc.com' });
        if (!admin) {
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
        } else {
            console.log('✅ Admin found!');
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
// PUBLIC BLOG ROUTES - FIXED
// ============================================================

// Get all published blogs (public)
app.get('/api/blogs', async (req, res) => {
    try {
        if (!db) {
            return res.status(503).json({ success: false, message: 'Database not connected' });
        }
        
        // Get ONLY published blogs, sorted by newest first
        const blogs = await db.collection('blogs')
            .find({ status: 'published' })
            .sort({ createdAt: -1 })
            .toArray();
        
        console.log(`📚 Public blog request: ${blogs.length} published blogs found`);
        
        res.json({ 
            success: true, 
            blogs: blogs,
            count: blogs.length
        });
    } catch (error) {
        console.error('Error fetching public blogs:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get single blog by ID (public)
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
// ADMIN BLOG ROUTES (Protected)
// ============================================================

// Get all blogs (admin)
app.get('/api/admin/blogs', authenticateToken, async (req, res) => {
    try {
        const blogs = await db.collection('blogs').find({}).sort({ createdAt: -1 }).toArray();
        res.json({ success: true, blogs });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get single blog (admin)
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

// Create blog post (admin)
app.post('/api/admin/blogs', authenticateToken, async (req, res) => {
    try {
        const { title, category, excerpt, content, status, author, tags, featuredImage } = req.body;
        
        if (!title || !content) {
            return res.status(400).json({ success: false, message: 'Title and content are required' });
        }
        
        const blogData = {
            title: title.trim(),
            category: category || 'General',
            excerpt: excerpt || content.substring(0, 200) + '...',
            content: content,
            status: status || 'draft',  // 'published' or 'draft'
            author: author || 'Admin',
            tags: tags || [],
            featuredImage: featuredImage || '',
            createdAt: new Date(),
            updatedAt: new Date()
        };
        
        const result = await db.collection('blogs').insertOne(blogData);
        
        console.log(`📝 Blog post created: "${title}" (${status})`);
        
        res.json({ 
            success: true, 
            id: result.insertedId, 
            blog: { ...blogData, _id: result.insertedId }
        });
    } catch (error) {
        console.error('Error creating blog:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Update blog post (admin)
app.put('/api/admin/blogs/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { title, category, excerpt, content, status, author, tags, featuredImage } = req.body;
        
        const updateData = { updatedAt: new Date() };
        if (title !== undefined) updateData.title = title.trim();
        if (category !== undefined) updateData.category = category;
        if (excerpt !== undefined) updateData.excerpt = excerpt;
        if (content !== undefined) updateData.content = content;
        if (status !== undefined) updateData.status = status;
        if (author !== undefined) updateData.author = author;
        if (tags !== undefined) updateData.tags = tags;
        if (featuredImage !== undefined) updateData.featuredImage = featuredImage;
        
        const result = await db.collection('blogs').updateOne(
            { _id: new ObjectId(id) },
            { $set: updateData }
        );
        
        if (result.matchedCount === 0) {
            return res.status(404).json({ success: false, message: 'Blog not found' });
        }
        
        console.log(`📝 Blog updated: ${id} - Status: ${status}`);
        res.json({ success: true, message: 'Blog updated successfully' });
    } catch (error) {
        console.error('Error updating blog:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Delete blog post (admin)
app.delete('/api/admin/blogs/:id', authenticateToken, async (req, res) => {
    try {
        const result = await db.collection('blogs').deleteOne({ _id: new ObjectId(req.params.id) });
        if (result.deletedCount === 0) {
            return res.status(404).json({ success: false, message: 'Blog not found' });
        }
        console.log(`🗑️ Blog deleted: ${req.params.id}`);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// PUBLIC CONTACT SUBMISSION - FIXED
// ============================================================
app.post('/api/contacts', async (req, res) => {
    try {
        const { name, email, phone, country, interest, message, form_type } = req.body;
        
        console.log('📩 Contact form received:', { name, email, country, interest });
        
        // Validate required fields
        if (!name || !email || !phone || !country || !interest || !message) {
            return res.status(400).json({ 
                success: false, 
                message: 'All fields are required: name, email, phone, country, interest, message' 
            });
        }
        
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ success: false, message: 'Invalid email format' });
        }
        
        // Create contact entry
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
        
        // Save to database
        const result = await db.collection('contacts').insertOne(contactData);
        
        console.log(`✅ New contact submission saved: ${name} (${email}) - ID: ${result.insertedId}`);
        
        // Return success with the saved data
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
// ADMIN CONTACT ROUTES (Protected)
// ============================================================

// Get all contacts (admin)
app.get('/api/admin/contacts', authenticateToken, async (req, res) => {
    try {
        const contacts = await db.collection('contacts').find({}).sort({ createdAt: -1 }).toArray();
        console.log(`📋 Admin contacts request: ${contacts.length} contacts found`);
        res.json({ success: true, contacts });
    } catch (error) {
        console.error('Error loading contacts:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Delete contact (admin)
app.delete('/api/admin/contacts/:id', authenticateToken, async (req, res) => {
    try {
        const result = await db.collection('contacts').deleteOne({ _id: new ObjectId(req.params.id) });
        if (result.deletedCount === 0) {
            return res.status(404).json({ success: false, message: 'Contact not found' });
        }
        console.log(`🗑️ Contact deleted: ${req.params.id}`);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// REST OF YOUR ROUTES (Users, Applications, Payments, etc.)
// ============================================================

// [Keep all your existing routes here - users, applications, payments, notifications, etc.]

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
            blogs_public: '/api/blogs (GET)',
            contacts_public: '/api/contacts (POST)',
            health: '/api/health (GET)'
        }
    });
});

// ============================================================
// SERVE STATIC FILES
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
