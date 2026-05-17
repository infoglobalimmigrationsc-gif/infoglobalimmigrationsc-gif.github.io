// routes/admin.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { MongoClient, ObjectId } = require('mongodb');

// MongoDB Connection
const uri = process.env.MONGODB_URI;
let db;

async function connectDB() {
    if (!db) {
        const client = new MongoClient(uri);
        await client.connect();
        db = client.db('gisc-app');
    }
    return db;
}

// Admin Authentication Middleware
const verifyAdmin = async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const db = await connectDB();
        const admin = await db.collection('admins').findOne({ _id: new ObjectId(decoded.id) });
        
        if (!admin) {
            return res.status(401).json({ success: false, message: 'Invalid token' });
        }
        
        req.admin = admin;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, message: 'Invalid token' });
    }
};

// ============ ADMIN AUTHENTICATION ============

// Admin Login
router.post('/admin/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const db = await connectDB();
        
        const admin = await db.collection('admins').findOne({ email });
        if (!admin) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
        
        const isValidPassword = await bcrypt.compare(password, admin.password);
        if (!isValidPassword) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
        
        const token = jwt.sign(
            { id: admin._id, email: admin.email, role: admin.role },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );
        
        res.json({
            success: true,
            token,
            admin: {
                id: admin._id,
                name: admin.name,
                email: admin.email,
                role: admin.role
            }
        });
    } catch (error) {
        console.error('Admin login error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Validate Session
router.post('/admin/validate', verifyAdmin, async (req, res) => {
    res.json({ valid: true, admin: req.admin });
});

// ============ BLOG MANAGEMENT ============

// Get all blogs (with optional filters)
router.get('/blogs', async (req, res) => {
    try {
        const { status, limit = 50 } = req.query;
        const db = await connectDB();
        
        let query = {};
        if (status && status !== 'all') {
            query.status = status;
        }
        
        const blogs = await db.collection('blogs')
            .find(query)
            .sort({ createdAt: -1 })
            .limit(parseInt(limit))
            .toArray();
        
        res.json(blogs);
    } catch (error) {
        console.error('Error fetching blogs:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Get single blog by slug
router.get('/blogs/:slug', async (req, res) => {
    try {
        const db = await connectDB();
        const blog = await db.collection('blogs').findOne({ slug: req.params.slug });
        
        if (!blog) {
            return res.status(404).json({ success: false, message: 'Blog not found' });
        }
        
        res.json(blog);
    } catch (error) {
        console.error('Error fetching blog:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Create blog post (Admin only)
router.post('/blogs/create', verifyAdmin, async (req, res) => {
    try {
        const { title, slug, excerpt, content, category, author, status, featuredImage } = req.body;
        const db = await connectDB();
        
        const blog = {
            title,
            slug,
            excerpt,
            content,
            category,
            author,
            status: status || 'draft',
            featuredImage: featuredImage || null,
            createdAt: new Date(),
            updatedAt: new Date(),
            views: 0
        };
        
        const result = await db.collection('blogs').insertOne(blog);
        
        res.json({
            success: true,
            blog: { ...blog, _id: result.insertedId }
        });
    } catch (error) {
        console.error('Error creating blog:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Update blog post (Admin only)
router.put('/blogs/:id', verifyAdmin, async (req, res) => {
    try {
        const { title, excerpt, content, category, status, featuredImage } = req.body;
        const db = await connectDB();
        
        const updateData = {
            title,
            excerpt,
            content,
            category,
            status,
            featuredImage,
            updatedAt: new Date()
        };
        
        await db.collection('blogs').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: updateData }
        );
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating blog:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Delete blog post (Admin only)
router.delete('/blogs/:id', verifyAdmin, async (req, res) => {
    try {
        const db = await connectDB();
        await db.collection('blogs').deleteOne({ _id: new ObjectId(req.params.id) });
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting blog:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Publish blog to frontend
router.post('/blogs/:id/publish', verifyAdmin, async (req, res) => {
    try {
        const db = await connectDB();
        await db.collection('blogs').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { status: 'published', publishedAt: new Date() } }
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Error publishing blog:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ============ APPLICATION MANAGEMENT ============

// Get all applications (Admin only)
router.get('/applications', verifyAdmin, async (req, res) => {
    try {
        const db = await connectDB();
        const applications = await db.collection('applications')
            .find()
            .sort({ createdAt: -1 })
            .toArray();
        res.json(applications);
    } catch (error) {
        console.error('Error fetching applications:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Update application status (Admin only)
router.put('/applications/:id/status', verifyAdmin, async (req, res) => {
    try {
        const { status } = req.body;
        const db = await connectDB();
        
        await db.collection('applications').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { status, updatedAt: new Date() } }
        );
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating application:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ============ USER MANAGEMENT ============

// Get all users (Admin only)
router.get('/users', verifyAdmin, async (req, res) => {
    try {
        const db = await connectDB();
        const users = await db.collection('users')
            .find({}, { password: 0 }) // Exclude password
            .sort({ createdAt: -1 })
            .toArray();
        res.json(users);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Delete user (Admin only)
router.delete('/users/:id', verifyAdmin, async (req, res) => {
    try {
        const db = await connectDB();
        await db.collection('users').deleteOne({ _id: new ObjectId(req.params.id) });
        await db.collection('applications').deleteOne({ userId: req.params.id });
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ============ CONTACT SUBMISSIONS ============

// Get contact submissions (Admin only)
router.get('/contacts', verifyAdmin, async (req, res) => {
    try {
        const db = await connectDB();
        const contacts = await db.collection('contacts')
            .find()
            .sort({ createdAt: -1 })
            .toArray();
        res.json(contacts);
    } catch (error) {
        console.error('Error fetching contacts:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ============ APPOINTMENTS ============

// Get appointments (Admin only)
router.get('/appointments', verifyAdmin, async (req, res) => {
    try {
        const db = await connectDB();
        const appointments = await db.collection('appointments')
            .find()
            .sort({ createdAt: -1 })
            .toArray();
        res.json(appointments);
    } catch (error) {
        console.error('Error fetching appointments:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ============ DASHBOARD STATS ============

// Get dashboard stats (Admin only)
router.get('/dashboard/stats', verifyAdmin, async (req, res) => {
    try {
        const db = await connectDB();
        
        const [totalUsers, totalApps, pendingApps, approvedApps, totalBlogs] = await Promise.all([
            db.collection('users').countDocuments(),
            db.collection('applications').countDocuments(),
            db.collection('applications').countDocuments({ status: 'pending' }),
            db.collection('applications').countDocuments({ status: 'approved' }),
            db.collection('blogs').countDocuments()
        ]);
        
        res.json({
            totalUsers,
            totalApps,
            pendingApps,
            approvedApps,
            totalBlogs
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
