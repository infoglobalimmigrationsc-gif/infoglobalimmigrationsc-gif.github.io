// server.js - GISC APPLICANT PORTAL 2.0 - COMPLETE FIXED VERSION
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
// PASSWORD RESET - Custom Flow
// ============================================================
app.post('/api/users/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, message: 'Email is required' });
        if (!db) return res.status(503).json({ success: false, message: 'Database not connected' });

        const user = await db.collection('users').findOne({ email: email });
        if (!user) return res.status(404).json({ success: false, message: 'No account found with this email address.' });

        const crypto = require('crypto');
        const resetToken = crypto.randomBytes(32).toString('hex');
        const tokenExpiry = new Date();
        tokenExpiry.setHours(tokenExpiry.getHours() + 1);

        await db.collection('users').updateOne(
            { email: email },
            { $set: { resetToken: resetToken, resetTokenExpiry: tokenExpiry } }
        );

        const resetLink = `https://globalimmigrationsclr.com/portal/reset-password.html?token=${resetToken}`;
        console.log(`🔗 RESET LINK FOR ${email}: ${resetLink}`);

        res.json({ success: true, message: 'Reset link generated', debugLink: resetLink });
    } catch (error) {
        console.error('Error in forgot-password:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/users/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        if (!token || !newPassword) return res.status(400).json({ success: false, message: 'Token and password are required' });
        if (!db) return res.status(503).json({ success: false, message: 'Database not connected' });

        const user = await db.collection('users').findOne({ resetToken: token, resetTokenExpiry: { $gt: new Date() } });
        if (!user) return res.status(400).json({ success: false, message: 'Invalid or expired reset token.' });

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await db.collection('users').updateOne(
            { _id: user._id },
            { $set: { password: hashedPassword, updatedAt: new Date() }, $unset: { resetToken: "", resetTokenExpiry: "" } }
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
        if (!db) return res.status(503).json({ success: false, message: 'Database not connected' });
        
        const admin = await db.collection('admins').findOne({ email: email });
        if (!admin) return res.status(401).json({ success: false, message: 'Invalid credentials' });
        
        const isValid = await bcrypt.compare(password, admin.password);
        if (!isValid) return res.status(401).json({ success: false, message: 'Invalid credentials' });
        
        const token = jwt.sign(
            { id: admin._id, email: admin.email, role: admin.role || 'admin' },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '24h' }
        );
        res.json({
            success: true,
            token: token,
            admin: { id: admin._id, name: admin.name, email: admin.email, role: admin.role || 'admin' }
        });
    } catch (error) {
        console.error('❌ Login error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// AGENT API ENDPOINTS
// ============================================================

// ============================================================
// AGENT REGISTRATION
// ============================================================
app.post('/api/agent/register', async (req, res) => {
    try {
        const { 
            fullName, organization, phone, email, location, 
            identification, professionalBackground, experience,
            socialMedia, references, agentCategory, status,
            agreementStatus
        } = req.body;

        // Validate required fields
        if (!fullName || !email || !phone) {
            return res.status(400).json({ 
                success: false, 
                message: 'Full name, email and phone are required' 
            });
        }

        // Check if email already exists
        const existingAgent = await db.collection('agents').findOne({ email: email.toLowerCase() });
        if (existingAgent) {
            return res.status(400).json({ 
                success: false, 
                message: 'An agent with this email already exists' 
            });
        }

        // Generate unique Agent ID
        const count = await db.collection('agents').countDocuments();
        const agentId = `GISC-AGT${String(count + 1).padStart(3, '0')}`;
        
        // Generate unique Referral Code
        const referralCode = `GISC-DAR${String(count + 1).padStart(3, '0')}`;

        const agentData = {
            fullName,
            organization: organization || '',
            phone,
            email: email.toLowerCase(),
            location: location || '',
            identification: identification || '',
            professionalBackground: professionalBackground || '',
            experience: experience || '',
            socialMedia: socialMedia || '',
            references: references || [],
            agentCategory: agentCategory || 'Referral Agent',
            status: 'Pending', // Pending, Approved, Suspended, Inactive, Terminated
            agentId,
            referralCode,
            agreementStatus: agreementStatus || 'Pending',
            dateApproved: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            // Commission settings
            commissionRate: 0,
            totalCommissionEarned: 0,
            totalCommissionPaid: 0,
            pendingCommission: 0,
            // Performance
            totalReferrals: 0,
            qualifiedApplicants: 0,
            activeApplicants: 0,
            successfulApplications: 0,
            totalRevenueGenerated: 0,
            performanceLevel: 'Registered Agent',
            // Security
            password: null, // Will be set when approved
            resetToken: null,
            resetTokenExpiry: null
        };

        const result = await db.collection('agents').insertOne(agentData);

        // Log the registration
        await db.collection('audit_logs').insertOne({
            action: 'AGENT_REGISTERED',
            agentId: agentId,
            agentEmail: email.toLowerCase(),
            timestamp: new Date(),
            details: { fullName, email, agentCategory }
        });

        res.json({
            success: true,
            message: 'Agent registration submitted successfully. You will be notified when your account is approved.',
            agentId: agentId,
            referralCode: referralCode
        });

    } catch (error) {
        console.error('Agent registration error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// AGENT LOGIN
// ============================================================
app.post('/api/agent/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password are required' });
        }

        const agent = await db.collection('agents').findOne({ email: email.toLowerCase() });
        if (!agent) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        // Check if agent is approved
        if (agent.status !== 'Approved') {
            return res.status(403).json({ 
                success: false, 
                message: `Your account is ${agent.status.toLowerCase()}. Please contact GISC Admin for assistance.` 
            });
        }

        // Check if password exists
        if (!agent.password) {
            return res.status(403).json({ 
                success: false, 
                message: 'Please set your password before logging in. Use the password reset feature.' 
            });
        }

        const isValid = await bcrypt.compare(password, agent.password);
        if (!isValid) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { 
                id: agent._id, 
                email: agent.email, 
                agentId: agent.agentId,
                role: 'agent',
                status: agent.status
            },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '24h' }
        );

        // Update last login
        await db.collection('agents').updateOne(
            { _id: agent._id },
            { $set: { lastLogin: new Date() } }
        );

        res.json({
            success: true,
            token: token,
            agent: {
                id: agent._id,
                fullName: agent.fullName,
                email: agent.email,
                agentId: agent.agentId,
                referralCode: agent.referralCode,
                agentCategory: agent.agentCategory,
                status: agent.status
            }
        });

    } catch (error) {
        console.error('Agent login error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// AGENT PASSWORD RESET
// ============================================================
app.post('/api/agent/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

        const agent = await db.collection('agents').findOne({ email: email.toLowerCase() });
        if (!agent) {
            return res.status(404).json({ success: false, message: 'No agent found with this email address.' });
        }

        const crypto = require('crypto');
        const resetToken = crypto.randomBytes(32).toString('hex');
        const tokenExpiry = new Date();
        tokenExpiry.setHours(tokenExpiry.getHours() + 1);

        await db.collection('agents').updateOne(
            { email: email.toLowerCase() },
            { $set: { resetToken: resetToken, resetTokenExpiry: tokenExpiry } }
        );

        const resetLink = `https://globalimmigrationsclr.com/agent/reset-password.html?token=${resetToken}`;
        console.log(`🔗 AGENT RESET LINK FOR ${email}: ${resetLink}`);

        res.json({ success: true, message: 'Reset link generated', debugLink: resetLink });
    } catch (error) {
        console.error('Error in agent forgot-password:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/agent/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        if (!token || !newPassword) {
            return res.status(400).json({ success: false, message: 'Token and password are required' });
        }

        const agent = await db.collection('agents').findOne({ 
            resetToken: token, 
            resetTokenExpiry: { $gt: new Date() } 
        });
        if (!agent) {
            return res.status(400).json({ success: false, message: 'Invalid or expired reset token.' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await db.collection('agents').updateOne(
            { _id: agent._id },
            { 
                $set: { password: hashedPassword, updatedAt: new Date() }, 
                $unset: { resetToken: "", resetTokenExpiry: "" } 
            }
        );

        // Log the password change
        await db.collection('audit_logs').insertOne({
            action: 'AGENT_PASSWORD_RESET',
            agentId: agent.agentId,
            agentEmail: agent.email,
            timestamp: new Date()
        });

        res.json({ success: true, message: 'Password reset successfully' });
    } catch (error) {
        console.error('Error in agent reset-password:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// AGENT MIDDLEWARE
// ============================================================
function authenticateAgent(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
        if (err) {
            return res.status(403).json({ success: false, message: 'Invalid token' });
        }
        if (user.role !== 'agent') {
            return res.status(403).json({ success: false, message: 'Access denied. Agent role required.' });
        }
        req.agent = user;
        next();
    });
}

// ============================================================
// AGENT PROFILE
// ============================================================
app.get('/api/agent/profile', authenticateAgent, async (req, res) => {
    try {
        const agent = await db.collection('agents').findOne({ _id: new ObjectId(req.agent.id) });
        if (!agent) {
            return res.status(404).json({ success: false, message: 'Agent not found' });
        }

        // Remove sensitive data
        delete agent.password;
        delete agent.resetToken;
        delete agent.resetTokenExpiry;

        res.json({ success: true, agent });
    } catch (error) {
        console.error('Error fetching agent profile:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.put('/api/agent/profile', authenticateAgent, async (req, res) => {
    try {
        const updateData = { ...req.body, updatedAt: new Date() };
        delete updateData._id;
        delete updateData.password;
        delete updateData.resetToken;
        delete updateData.resetTokenExpiry;

        const result = await db.collection('agents').updateOne(
            { _id: new ObjectId(req.agent.id) },
            { $set: updateData }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ success: false, message: 'Agent not found' });
        }

        res.json({ success: true, message: 'Profile updated successfully' });
    } catch (error) {
        console.error('Error updating agent profile:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// AGENT DASHBOARD
// ============================================================
app.get('/api/agent/dashboard', authenticateAgent, async (req, res) => {
    try {
        const agentId = req.agent.agentId;
        
        // Get agent data
        const agent = await db.collection('agents').findOne({ _id: new ObjectId(req.agent.id) });
        if (!agent) {
            return res.status(404).json({ success: false, message: 'Agent not found' });
        }

        // Get applicants for this agent
        const applicants = await db.collection('applicants')
            .find({ agentId: agentId })
            .sort({ createdAt: -1 })
            .toArray();

        // Get applications for this agent's applicants
        const applicantIds = applicants.map(a => a.applicantId);
        const applications = await db.collection('applications')
            .find({ applicantId: { $in: applicantIds } })
            .toArray();

        // Get commissions for this agent
        const commissions = await db.collection('commissions')
            .find({ agentId: agentId })
            .sort({ createdAt: -1 })
            .toArray();

        // Get notifications for this agent
        const notifications = await db.collection('agent_notifications')
            .find({ agentId: agentId })
            .sort({ createdAt: -1 })
            .limit(20)
            .toArray();

        // Calculate dashboard stats
        const totalReferrals = applicants.length;
        const qualifiedApplicants = applicants.filter(a => a.status === 'Qualified').length;
        const activeApplicants = applicants.filter(a => ['Registered', 'Under Assessment', 'Qualified', 'Package Selected', 'Agreement Pending', 'Payment Pending', 'Payment Verified'].includes(a.status)).length;
        const successfulApplications = applications.filter(a => a.status === 'Completed').length;

        // Calculate revenue
        const totalRevenueGenerated = applications
            .filter(a => a.paymentStatus === 'Paid' || a.paymentStatus === 'Verified')
            .reduce((sum, a) => sum + (a.totalServiceFee || 0), 0);

        // Calculate commission totals
        const commissionEarned = commissions
            .filter(c => c.status === 'Eligible' || c.status === 'Paid')
            .reduce((sum, c) => sum + c.commissionAmount, 0);
        const commissionPaid = commissions
            .filter(c => c.status === 'Paid')
            .reduce((sum, c) => sum + c.commissionAmount, 0);
        const pendingCommission = commissions
            .filter(c => c.status === 'Eligible' || c.status === 'Pending')
            .reduce((sum, c) => sum + c.commissionAmount, 0);

        // Calculate refund adjustments
        const refundAdjustments = commissions
            .filter(c => c.status === 'Reversed')
            .reduce((sum, c) => sum + c.commissionAmount, 0);

        // Determine performance level
        const successCount = successfulApplications;
        let performanceLevel = 'Registered Agent';
        if (successCount >= 25) performanceLevel = 'ELITE AGENT';
        else if (successCount >= 10) performanceLevel = 'PREMIUM AGENT';
        else if (successCount >= 3) performanceLevel = 'ACTIVE AGENT';

        // Recent activity
        const recentApplicants = applicants.slice(0, 5);
        const recentApplications = applications.slice(0, 5);
        const recentCommissions = commissions.slice(0, 5);
        const recentNotifications = notifications.slice(0, 10);

        // Pending actions
        const pendingActions = [];
        const pendingApplicants = applicants.filter(a => a.status === 'Registered' || a.status === 'Under Assessment');
        if (pendingApplicants.length > 0) {
            pendingActions.push({
                type: 'applicant_review',
                count: pendingApplicants.length,
                message: `${pendingApplicants.length} applicant(s) pending review`
            });
        }

        const pendingPayments = applications.filter(a => a.paymentStatus === 'Pending' || a.paymentStatus === 'Pending Verification');
        if (pendingPayments.length > 0) {
            pendingActions.push({
                type: 'payment_verification',
                count: pendingPayments.length,
                message: `${pendingPayments.length} payment(s) pending verification`
            });
        }

        const eligibleCommissions = commissions.filter(c => c.status === 'Eligible');
        if (eligibleCommissions.length > 0) {
            const totalEligible = eligibleCommissions.reduce((sum, c) => sum + c.commissionAmount, 0);
            pendingActions.push({
                type: 'commission_settlement',
                count: eligibleCommissions.length,
                message: `${eligibleCommissions.length} commission(s) eligible for settlement ($${totalEligible.toFixed(2)})`
            });
        }

        // Next settlement date (1st of next month)
        const now = new Date();
        const nextSettlement = new Date(now.getFullYear(), now.getMonth() + 1, 1);

        res.json({
            success: true,
            dashboard: {
                stats: {
                    totalReferrals,
                    qualifiedApplicants,
                    activeApplicants,
                    successfulApplications,
                    totalRevenueGenerated,
                    commissionEarned,
                    commissionPaid,
                    pendingCommission,
                    refundAdjustments,
                    performanceLevel
                },
                recent: {
                    applicants: recentApplicants,
                    applications: recentApplications,
                    commissions: recentCommissions,
                    notifications: recentNotifications
                },
                pendingActions,
                nextSettlementDate: nextSettlement,
                agent: {
                    fullName: agent.fullName,
                    agentId: agent.agentId,
                    referralCode: agent.referralCode,
                    agentCategory: agent.agentCategory,
                    status: agent.status
                }
            }
        });

    } catch (error) {
        console.error('Error fetching agent dashboard:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});


// ============================================================
// AGENT APPLICANT MANAGEMENT
// ============================================================

// Generate unique Applicant ID
async function generateApplicantId() {
    const count = await db.collection('applicants').countDocuments();
    return `GISC-APP-${String(count + 1).padStart(6, '0')}`;
}

// Check for duplicate applicant
async function checkDuplicateApplicant(email, phone) {
    const existing = await db.collection('applicants').findOne({
        $or: [
            { email: email.toLowerCase() },
            { phone: phone }
        ]
    });
    return existing;
}

// Get all applicants for an agent
app.get('/api/agent/applicants', authenticateAgent, async (req, res) => {
    try {
        const agentId = req.agent.agentId;
        const { search, status, limit } = req.query;
        
        const query = { agentId: agentId };
        
        if (search) {
            query.$or = [
                { fullName: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { applicantId: { $regex: search, $options: 'i' } }
            ];
        }
        
        if (status) {
            query.status = status;
        }
        
        let cursor = db.collection('applicants')
            .find(query)
            .sort({ createdAt: -1 });
            
        if (limit) {
            cursor = cursor.limit(parseInt(limit));
        }
        
        const applicants = await cursor.toArray();
        
        // Get application data for each applicant
        const applicantIds = applicants.map(a => a.applicantId);
        const applications = await db.collection('applications')
            .find({ applicantId: { $in: applicantIds } })
            .toArray();
        
        const appMap = {};
        applications.forEach(app => {
            appMap[app.applicantId] = app;
        });
        
        const enrichedApplicants = applicants.map(a => ({
            ...a,
            application: appMap[a.applicantId] || null
        }));
        
        res.json({ success: true, applicants: enrichedApplicants, count: enrichedApplicants.length });
    } catch (error) {
        console.error('Error fetching applicants:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get single applicant
app.get('/api/agent/applicants/:applicantId', authenticateAgent, async (req, res) => {
    try {
        const agentId = req.agent.agentId;
        const { applicantId } = req.params;
        
        const applicant = await db.collection('applicants').findOne({ 
            applicantId: applicantId,
            agentId: agentId
        });
        
        if (!applicant) {
            return res.status(404).json({ success: false, message: 'Applicant not found or does not belong to you' });
        }
        
        // Get application data
        const application = await db.collection('applications')
            .findOne({ applicantId: applicantId });
        
        res.json({ success: true, applicant, application: application || null });
    } catch (error) {
        console.error('Error fetching applicant:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Create new applicant
app.post('/api/agent/applicants', authenticateAgent, async (req, res) => {
    try {
        const agentId = req.agent.agentId;
        const agent = await db.collection('agents').findOne({ _id: new ObjectId(req.agent.id) });
        
        if (!agent || agent.status !== 'Approved') {
            return res.status(403).json({ 
                success: false, 
                message: 'Only approved agents can submit applicants' 
            });
        }
        
        const {
            fullName, phone, email, countryOfInterest, serviceRequested,
            referralDate, sourceOfLead, dateOfBirth, nationality,
            currentCountry, educationLevel, highestQualification,
            workExperience, preferredDestination, programmeInterest,
            additionalInformation
        } = req.body;
        
        // Validate required fields
        if (!fullName || !phone || !email || !countryOfInterest || !serviceRequested) {
            return res.status(400).json({ 
                success: false, 
                message: 'Full name, phone, email, country of interest, and service requested are required' 
            });
        }
        
        // Check for duplicates
        const existing = await checkDuplicateApplicant(email, phone);
        if (existing) {
            return res.status(409).json({
                success: false,
                message: 'This applicant already exists in the GISC system. Please contact GISC Admin regarding ownership.',
                existingApplicant: {
                    applicantId: existing.applicantId,
                    fullName: existing.fullName,
                    email: existing.email,
                    phone: existing.phone,
                    status: existing.status,
                    agentId: existing.agentId
                }
            });
        }
        
        // Generate unique Applicant ID
        const applicantId = await generateApplicantId();
        
        const applicantData = {
            applicantId,
            agentId: agentId,
            agentReferralCode: agent.referralCode,
            fullName,
            phone,
            email: email.toLowerCase(),
            countryOfInterest,
            serviceRequested,
            referralDate: referralDate || new Date().toISOString().split('T')[0],
            sourceOfLead: sourceOfLead || 'Agent Referral',
            dateOfBirth: dateOfBirth || '',
            nationality: nationality || '',
            currentCountry: currentCountry || '',
            educationLevel: educationLevel || '',
            highestQualification: highestQualification || '',
            workExperience: workExperience || '',
            preferredDestination: preferredDestination || '',
            programmeInterest: programmeInterest || '',
            additionalInformation: additionalInformation || '',
            status: 'Registered',
            applicationStage: 'Lead',
            paymentStatus: 'No Payment',
            commissionStatus: 'No Commission',
            assignedCounselor: null,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        
        const result = await db.collection('applicants').insertOne(applicantData);
        
        // Create application record
        const applicationData = {
            applicantId: applicantId,
            agentId: agentId,
            agentReferralCode: agent.referralCode,
            applicantName: fullName,
            email: email.toLowerCase(),
            phone: phone,
            service: serviceRequested,
            destination: countryOfInterest,
            status: 'Lead',
            stage: 'Lead',
            paymentStatus: 'No Payment',
            totalServiceFee: 0,
            amountReceived: 0,
            amountRemaining: 0,
            milestones: [
                {
                    milestone: 'Applicant Registered',
                    status: 'Completed',
                    date: new Date().toISOString(),
                    notes: 'Applicant registered by agent'
                }
            ],
            timeline: [
                {
                    event: 'Applicant Registered',
                    description: 'Applicant was registered in the GISC system',
                    date: new Date().toISOString(),
                    actor: 'Agent'
                }
            ],
            documents: {},
            payments: [],
            commissions: [],
            createdAt: new Date(),
            updatedAt: new Date()
        };
        
        await db.collection('applications').insertOne(applicationData);
        
        // Update agent stats
        await db.collection('agents').updateOne(
            { _id: agent._id },
            { 
                $inc: { totalReferrals: 1 },
                $set: { updatedAt: new Date() }
            }
        );
        
        // Log the action
        await db.collection('audit_logs').insertOne({
            action: 'APPLICANT_REGISTERED',
            agentId: agentId,
            agentEmail: agent.email,
            applicantId: applicantId,
            applicantName: fullName,
            timestamp: new Date()
        });
        
        res.json({
            success: true,
            message: 'Applicant registered successfully',
            applicantId: applicantId,
            applicant: applicantData
        });
        
    } catch (error) {
        console.error('Error creating applicant:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Update applicant
app.put('/api/agent/applicants/:applicantId', authenticateAgent, async (req, res) => {
    try {
        const agentId = req.agent.agentId;
        const { applicantId } = req.params;
        
        // Check ownership
        const applicant = await db.collection('applicants').findOne({
            applicantId: applicantId,
            agentId: agentId
        });
        
        if (!applicant) {
            return res.status(404).json({ success: false, message: 'Applicant not found or does not belong to you' });
        }
        
        const updateData = { ...req.body, updatedAt: new Date() };
        delete updateData._id;
        delete updateData.applicantId;
        delete updateData.agentId;
        delete updateData.agentReferralCode;
        
        // Only allow certain fields to be updated
        const allowedUpdates = [
            'fullName', 'phone', 'email', 'countryOfInterest', 'serviceRequested',
            'referralDate', 'sourceOfLead', 'dateOfBirth', 'nationality',
            'currentCountry', 'educationLevel', 'highestQualification',
            'workExperience', 'preferredDestination', 'programmeInterest',
            'additionalInformation'
        ];
        
        const filteredUpdate = {};
        for (const key of allowedUpdates) {
            if (updateData[key] !== undefined) {
                filteredUpdate[key] = updateData[key];
            }
        }
        
        // Cannot update status or payment status - only admin can
        // Cannot update commission status - system managed
        
        const result = await db.collection('applicants').updateOne(
            { applicantId: applicantId, agentId: agentId },
            { $set: filteredUpdate }
        );
        
        res.json({
            success: true,
            message: 'Applicant updated successfully'
        });
        
    } catch (error) {
        console.error('Error updating applicant:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Upload document for applicant
app.post('/api/agent/applicants/:applicantId/documents', authenticateAgent, async (req, res) => {
    try {
        const agentId = req.agent.agentId;
        const { applicantId } = req.params;
        const { docType, fileId, fileName, fileSize, fileType, fileUrl } = req.body;
        
        if (!docType || !fileId || !fileUrl) {
            return res.status(400).json({ 
                success: false, 
                message: 'docType, fileId, and fileUrl are required' 
            });
        }
        
        // Check ownership
        const applicant = await db.collection('applicants').findOne({
            applicantId: applicantId,
            agentId: agentId
        });
        
        if (!applicant) {
            return res.status(404).json({ success: false, message: 'Applicant not found or does not belong to you' });
        }
        
        const docData = {
            fileId,
            fileName: fileName || 'Unknown',
            fileSize: fileSize || 0,
            fileType: fileType || 'application/octet-stream',
            fileUrl: fileUrl,
            docType: docType,
            uploadedBy: 'agent',
            uploaderId: agentId,
            status: 'pending_review',
            uploadedAt: new Date().toISOString()
        };
        
        // Update applicant document
        await db.collection('applicants').updateOne(
            { applicantId: applicantId },
            { 
                $set: { updatedAt: new Date() },
                $push: { documents: docData }
            }
        );
        
        // Update application document
        await db.collection('applications').updateOne(
            { applicantId: applicantId },
            {
                $set: { updatedAt: new Date() },
                $push: { 
                    [`documents.${docType}`]: docData,
                    uploadHistory: {
                        filename: fileName || 'Unknown',
                        docType: docType,
                        timestamp: new Date().toISOString(),
                        status: 'submitted'
                    }
                }
            }
        );
        
        // Add timeline entry
        await db.collection('applications').updateOne(
            { applicantId: applicantId },
            {
                $push: {
                    timeline: {
                        event: 'Document Uploaded',
                        description: `${docType.replace('_', ' ')} uploaded by agent`,
                        date: new Date().toISOString(),
                        actor: 'Agent'
                    }
                }
            }
        );
        
        res.json({
            success: true,
            message: 'Document uploaded successfully',
            document: docData
        });
        
    } catch (error) {
        console.error('Error uploading document:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get applicant timeline
app.get('/api/agent/applicants/:applicantId/timeline', authenticateAgent, async (req, res) => {
    try {
        const agentId = req.agent.agentId;
        const { applicantId } = req.params;
        
        // Check ownership
        const applicant = await db.collection('applicants').findOne({
            applicantId: applicantId,
            agentId: agentId
        });
        
        if (!applicant) {
            return res.status(404).json({ success: false, message: 'Applicant not found' });
        }
        
        const application = await db.collection('applications')
            .findOne({ applicantId: applicantId });
        
        if (!application) {
            return res.json({ success: true, timeline: [] });
        }
        
        res.json({
            success: true,
            timeline: application.timeline || [],
            milestones: application.milestones || []
        });
        
    } catch (error) {
        console.error('Error fetching timeline:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});


// ============================================================
// AGENT APPLICATION TRACKING
// ============================================================

// Get all applications for agent's applicants
app.get('/api/agent/applications', authenticateAgent, async (req, res) => {
    try {
        const agentId = req.agent.agentId;
        const { status, search, limit } = req.query;
        
        const query = { agentId: agentId };
        
        if (status) {
            query.status = status;
        }
        
        if (search) {
            query.$or = [
                { applicantName: { $regex: search, $options: 'i' } },
                { applicantId: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }
        
        let cursor = db.collection('applications')
            .find(query)
            .sort({ updatedAt: -1 });
            
        if (limit) {
            cursor = cursor.limit(parseInt(limit));
        }
        
        const applications = await cursor.toArray();
        
        res.json({ success: true, applications, count: applications.length });
    } catch (error) {
        console.error('Error fetching applications:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get single application
app.get('/api/agent/applications/:applicantId', authenticateAgent, async (req, res) => {
    try {
        const agentId = req.agent.agentId;
        const { applicantId } = req.params;
        
        const application = await db.collection('applications').findOne({
            applicantId: applicantId,
            agentId: agentId
        });
        
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
// AGENT PAYMENT TRACKING
// ============================================================

// Get payments for agent's applicants
app.get('/api/agent/payments', authenticateAgent, async (req, res) => {
    try {
        const agentId = req.agent.agentId;
        
        const applications = await db.collection('applications')
            .find({ agentId: agentId })
            .toArray();
        
        const payments = [];
        
        for (const app of applications) {
            if (app.payments && app.payments.length > 0) {
                for (const payment of app.payments) {
                    payments.push({
                        ...payment,
                        applicantId: app.applicantId,
                        applicantName: app.applicantName,
                        service: app.service,
                        packageName: app.packageName || 'Standard'
                    });
                }
            }
            
            // Include payment receipt if exists
            if (app.paymentReceipt) {
                payments.push({
                    ...app.paymentReceipt,
                    type: 'receipt',
                    applicantId: app.applicantId,
                    applicantName: app.applicantName,
                    service: app.service,
                    packageName: app.packageName || 'Standard'
                });
            }
        }
        
        // Sort by date
        payments.sort((a, b) => {
            const dateA = a.uploadedAt || a.createdAt || a.pendingAt || a.confirmedAt || '';
            const dateB = b.uploadedAt || b.createdAt || b.pendingAt || b.confirmedAt || '';
            return new Date(dateB) - new Date(dateA);
        });
        
        // Calculate totals
        const totalPaid = payments
            .filter(p => p.status === 'completed' || p.status === 'verified')
            .reduce((sum, p) => sum + (p.amount || 0), 0);
            
        const totalPending = payments
            .filter(p => p.status === 'pending' || p.status === 'pending_verification')
            .reduce((sum, p) => sum + (p.amount || 0), 0);
            
        const totalRejected = payments
            .filter(p => p.status === 'rejected')
            .reduce((sum, p) => sum + (p.amount || 0), 0);
        
        res.json({
            success: true,
            payments: payments,
            summary: {
                totalPaid,
                totalPending,
                totalRejected,
                count: payments.length
            }
        });
    } catch (error) {
        console.error('Error fetching payments:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get payment status summary for an applicant
app.get('/api/agent/applicants/:applicantId/payments', authenticateAgent, async (req, res) => {
    try {
        const agentId = req.agent.agentId;
        const { applicantId } = req.params;
        
        const application = await db.collection('applications').findOne({
            applicantId: applicantId,
            agentId: agentId
        });
        
        if (!application) {
            return res.status(404).json({ success: false, message: 'Application not found' });
        }
        
        // Calculate payment summary
        const payments = application.payments || [];
        const receipt = application.paymentReceipt;
        
        const paidPayments = payments.filter(p => p.status === 'completed');
        const pendingPayments = payments.filter(p => p.status === 'pending');
        const rejectedPayments = payments.filter(p => p.status === 'rejected');
        
        const totalPaid = paidPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
        const totalPending = pendingPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
        const totalRejected = rejectedPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
        
        const totalServiceFee = application.totalServiceFee || 0;
        const amountReceived = application.amountReceived || 0;
        const amountRemaining = application.amountRemaining || 0;
        
        res.json({
            success: true,
            paymentSummary: {
                totalServiceFee,
                amountReceived,
                amountRemaining,
                payments: payments,
                receipt: receipt,
                paidCount: paidPayments.length,
                pendingCount: pendingPayments.length,
                rejectedCount: rejectedPayments.length,
                totalPaid,
                totalPending,
                totalRejected
            }
        });
    } catch (error) {
        console.error('Error fetching payment summary:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});


// ============================================================
// AGENT COMMISSION SYSTEM
// ============================================================

// Commission structure
const COMMISSION_STRUCTURE = {
    'Profile Review & Eligibility Assessment': { fee: 25, rate: 0 },
    'Basic Support': { fee: 50, rate: 0.10 },
    'Application Guidance': { fee: 150, rate: 0.10 },
    'Basic Processing': { fee: 299, rate: 0.15 },
    'Standard Processing': { fee: 500, rate: 0.15 },
    'Silver Premium': { fee: 999, rate: 0.20 },
    'Gold': { fee: 1500, rate: 0.20 },
    'Platinum': { fee: 2500, rate: 0.20 },
    'Executive': { fee: 5000, rate: 0.25 }
};

// Calculate commission for a payment
function calculateCommission(packageName, amountReceived) {
    const packageInfo = COMMISSION_STRUCTURE[packageName];
    if (!packageInfo) {
        return { commissionAmount: 0, rate: 0, eligibleRevenue: 0 };
    }
    
    const rate = packageInfo.rate;
    const eligibleRevenue = amountReceived;
    const commissionAmount = eligibleRevenue * rate;
    
    return {
        commissionAmount: Math.round(commissionAmount * 100) / 100,
        rate: rate,
        eligibleRevenue: eligibleRevenue,
        packageFee: packageInfo.fee
    };
}

// Get commission data for agent
app.get('/api/agent/commissions', authenticateAgent, async (req, res) => {
    try {
        const agentId = req.agent.agentId;
        
        // Get agent data for totals
        const agent = await db.collection('agents').findOne({ _id: new ObjectId(req.agent.id) });
        
        // Get all commissions
        const commissions = await db.collection('commissions')
            .find({ agentId: agentId })
            .sort({ createdAt: -1 })
            .toArray();
        
        // Get commission settlements
        const settlements = await db.collection('commission_settlements')
            .find({ agentId: agentId })
            .sort({ settlementDate: -1 })
            .toArray();
        
        // Calculate totals
        const totalEarned = commissions
            .filter(c => c.status === 'Eligible' || c.status === 'Paid' || c.status === 'Settled')
            .reduce((sum, c) => sum + c.commissionAmount, 0);
            
        const totalPaid = commissions
            .filter(c => c.status === 'Paid' || c.status === 'Settled')
            .reduce((sum, c) => sum + c.commissionAmount, 0);
            
        const totalPending = commissions
            .filter(c => c.status === 'Pending' || c.status === 'Eligible')
            .reduce((sum, c) => sum + c.commissionAmount, 0);
            
        const totalReversed = commissions
            .filter(c => c.status === 'Reversed')
            .reduce((sum, c) => sum + c.commissionAmount, 0);
        
        // Get eligible for settlement (pending commissions with status 'Eligible')
        const eligibleForSettlement = commissions
            .filter(c => c.status === 'Eligible')
            .reduce((sum, c) => sum + c.commissionAmount, 0);
        
        // Next settlement date (1st of next month)
        const now = new Date();
        const nextSettlement = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        
        res.json({
            success: true,
            commissions: commissions,
            settlements: settlements,
            summary: {
                totalEarned,
                totalPaid,
                totalPending,
                totalReversed,
                eligibleForSettlement,
                nextSettlementDate: nextSettlement,
                commissionRate: agent.commissionRate || 0
            }
        });
    } catch (error) {
        console.error('Error fetching commissions:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get commission details for a specific applicant
app.get('/api/agent/applicants/:applicantId/commission', authenticateAgent, async (req, res) => {
    try {
        const agentId = req.agent.agentId;
        const { applicantId } = req.params;
        
        const commission = await db.collection('commissions')
            .findOne({ agentId: agentId, applicantId: applicantId });
        
        if (!commission) {
            return res.json({ success: true, commission: null, message: 'No commission found for this applicant' });
        }
        
        res.json({ success: true, commission });
    } catch (error) {
        console.error('Error fetching commission:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Commission eligibility check - called by admin when payment is verified
async function processCommission(applicantId, agentId, packageName, amountReceived, paymentId) {
    try {
        const agent = await db.collection('agents').findOne({ agentId: agentId });
        if (!agent || agent.status !== 'Approved') {
            return { success: false, message: 'Agent not found or not approved' };
        }
        
        // Check if commission already exists
        const existingCommission = await db.collection('commissions')
            .findOne({ applicantId: applicantId, paymentId: paymentId });
        
        if (existingCommission) {
            return { success: false, message: 'Commission already processed for this payment' };
        }
        
        // Calculate commission
        const calculation = calculateCommission(packageName, amountReceived);
        
        if (calculation.commissionAmount === 0) {
            return { success: false, message: 'No commission earned for this package' };
        }
        
        // Create commission record
        const commissionData = {
            agentId: agentId,
            agentReferralCode: agent.referralCode,
            applicantId: applicantId,
            paymentId: paymentId,
            packageName: packageName,
            packageFee: calculation.packageFee,
            amountReceived: amountReceived,
            eligibleRevenue: calculation.eligibleRevenue,
            rate: calculation.rate,
            commissionAmount: calculation.commissionAmount,
            status: 'Eligible', // Eligible, Paid, Reversed, Pending
            createdAt: new Date(),
            updatedAt: new Date()
        };
        
        const result = await db.collection('commissions').insertOne(commissionData);
        
        // Update agent stats
        await db.collection('agents').updateOne(
            { agentId: agentId },
            {
                $inc: {
                    totalCommissionEarned: calculation.commissionAmount,
                    pendingCommission: calculation.commissionAmount
                },
                $set: { updatedAt: new Date() }
            }
        );
        
        // Update application
        await db.collection('applications').updateOne(
            { applicantId: applicantId },
            {
                $push: {
                    commissions: {
                        commissionId: result.insertedId,
                        amount: calculation.commissionAmount,
                        rate: calculation.rate,
                        status: 'Eligible',
                        createdAt: new Date().toISOString()
                    }
                },
                $set: { updatedAt: new Date() }
            }
        );
        
        // Log the action
        await db.collection('audit_logs').insertOne({
            action: 'COMMISSION_CALCULATED',
            agentId: agentId,
            agentEmail: agent.email,
            applicantId: applicantId,
            commissionAmount: calculation.commissionAmount,
            packageName: packageName,
            amountReceived: amountReceived,
            timestamp: new Date()
        });
        
        // Create notification for agent
        await db.collection('agent_notifications').insertOne({
            agentId: agentId,
            title: 'Commission Earned',
            message: `You have earned $${calculation.commissionAmount.toFixed(2)} commission for applicant ${applicantId} (${packageName})`,
            type: 'commission',
            read: false,
            createdAt: new Date(),
            link: `/commission`
        });
        
        return { success: true, commission: commissionData };
        
    } catch (error) {
        console.error('Error processing commission:', error);
        return { success: false, message: error.message };
    }
}

// Process commission for a payment - called by admin
app.post('/api/admin/commissions/process', authenticateToken, async (req, res) => {
    try {
        const { applicantId, packageName, amountReceived, paymentId } = req.body;
        
        if (!applicantId || !packageName || !amountReceived) {
            return res.status(400).json({ 
                success: false, 
                message: 'applicantId, packageName, and amountReceived are required' 
            });
        }
        
        // Get applicant to find agent
        const applicant = await db.collection('applicants').findOne({ applicantId: applicantId });
        if (!applicant) {
            return res.status(404).json({ success: false, message: 'Applicant not found' });
        }
        
        const result = await processCommission(
            applicantId,
            applicant.agentId,
            packageName,
            amountReceived,
            paymentId || `PAY-${Date.now()}`
        );
        
        if (!result.success) {
            return res.status(400).json({ success: false, message: result.message });
        }
        
        res.json({ success: true, commission: result.commission });
    } catch (error) {
        console.error('Error processing commission:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Reverse commission (for refunds)
app.put('/api/admin/commissions/:commissionId/reverse', authenticateToken, async (req, res) => {
    try {
        const { commissionId } = req.params;
        const { reason } = req.body;
        
        const commission = await db.collection('commissions').findOne({ 
            _id: new ObjectId(commissionId) 
        });
        
        if (!commission) {
            return res.status(404).json({ success: false, message: 'Commission not found' });
        }
        
        if (commission.status === 'Reversed') {
            return res.status(400).json({ success: false, message: 'Commission already reversed' });
        }
        
        // Update commission status
        await db.collection('commissions').updateOne(
            { _id: new ObjectId(commissionId) },
            {
                $set: {
                    status: 'Reversed',
                    reversalReason: reason || 'Refund processed',
                    reversedAt: new Date(),
                    updatedAt: new Date()
                }
            }
        );
        
        // Update agent stats
        await db.collection('agents').updateOne(
            { agentId: commission.agentId },
            {
                $inc: {
                    totalCommissionEarned: -commission.commissionAmount,
                    pendingCommission: -commission.commissionAmount
                },
                $set: { updatedAt: new Date() }
            }
        );
        
        // Update application
        await db.collection('applications').updateOne(
            { applicantId: commission.applicantId },
            {
                $push: {
                    commissions: {
                        commissionId: commissionId,
                        amount: -commission.commissionAmount,
                        status: 'Reversed',
                        reason: reason || 'Refund processed',
                        reversedAt: new Date().toISOString()
                    }
                },
                $set: { updatedAt: new Date() }
            }
        );
        
        // Log the action
        await db.collection('audit_logs').insertOne({
            action: 'COMMISSION_REVERSED',
            agentId: commission.agentId,
            applicantId: commission.applicantId,
            commissionId: commissionId,
            amount: commission.commissionAmount,
            reason: reason || 'Refund processed',
            timestamp: new Date()
        });
        
        // Create notification for agent
        await db.collection('agent_notifications').insertOne({
            agentId: commission.agentId,
            title: 'Commission Reversed',
            message: `Commission of $${commission.commissionAmount.toFixed(2)} for applicant ${commission.applicantId} has been reversed. Reason: ${reason || 'Refund processed'}`,
            type: 'commission',
            read: false,
            createdAt: new Date(),
            link: `/commission`
        });
        
        res.json({ success: true, message: 'Commission reversed successfully' });
    } catch (error) {
        console.error('Error reversing commission:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Commission settlement - admin generates monthly statement
app.post('/api/admin/commissions/settle', authenticateToken, async (req, res) => {
    try {
        const { agentId, periodStart, periodEnd } = req.body;
        
        if (!agentId) {
            return res.status(400).json({ success: false, message: 'agentId is required' });
        }
        
        // Get eligible commissions
        const query = {
            agentId: agentId,
            status: 'Eligible'
        };
        
        if (periodStart && periodEnd) {
            query.createdAt = {
                $gte: new Date(periodStart),
                $lte: new Date(periodEnd)
            };
        }
        
        const eligibleCommissions = await db.collection('commissions')
            .find(query)
            .toArray();
        
        if (eligibleCommissions.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'No eligible commissions found for settlement' 
            });
        }
        
        const totalAmount = eligibleCommissions.reduce((sum, c) => sum + c.commissionAmount, 0);
        const commissionIds = eligibleCommissions.map(c => c._id.toString());
        
        // Create settlement record
        const settlementData = {
            agentId: agentId,
            periodStart: periodStart ? new Date(periodStart) : eligibleCommissions[0].createdAt,
            periodEnd: periodEnd ? new Date(periodEnd) : new Date(),
            commissionIds: commissionIds,
            totalAmount: totalAmount,
            status: 'Pending', // Pending, Paid, Rejected
            generatedAt: new Date(),
            paidAt: null,
            paymentReference: null,
            notes: req.body.notes || ''
        };
        
        const result = await db.collection('commission_settlements').insertOne(settlementData);
        
        // Update commission statuses
        for (const c of eligibleCommissions) {
            await db.collection('commissions').updateOne(
                { _id: c._id },
                {
                    $set: {
                        status: 'Settled',
                        settlementId: result.insertedId,
                        updatedAt: new Date()
                    }
                }
            );
        }
        
        // Update agent pending commission
        await db.collection('agents').updateOne(
            { agentId: agentId },
            {
                $inc: { pendingCommission: -totalAmount },
                $set: { updatedAt: new Date() }
            }
        );
        
        // Log the action
        await db.collection('audit_logs').insertOne({
            action: 'COMMISSION_SETTLEMENT_GENERATED',
            agentId: agentId,
            settlementId: result.insertedId,
            totalAmount: totalAmount,
            commissionCount: eligibleCommissions.length,
            timestamp: new Date()
        });
        
        res.json({
            success: true,
            settlementId: result.insertedId,
            totalAmount: totalAmount,
            commissionCount: eligibleCommissions.length,
            settlement: settlementData
        });
    } catch (error) {
        console.error('Error generating settlement:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Mark settlement as paid
app.put('/api/admin/commissions/settlement/:settlementId/pay', authenticateToken, async (req, res) => {
    try {
        const { settlementId } = req.params;
        const { paymentReference, notes } = req.body;
        
        const settlement = await db.collection('commission_settlements').findOne({
            _id: new ObjectId(settlementId)
        });
        
        if (!settlement) {
            return res.status(404).json({ success: false, message: 'Settlement not found' });
        }
        
        if (settlement.status === 'Paid') {
            return res.status(400).json({ success: false, message: 'Settlement already paid' });
        }
        
        // Update settlement
        await db.collection('commission_settlements').updateOne(
            { _id: new ObjectId(settlementId) },
            {
                $set: {
                    status: 'Paid',
                    paidAt: new Date(),
                    paymentReference: paymentReference || `PAY-${Date.now()}`,
                    notes: notes || settlement.notes,
                    updatedAt: new Date()
                }
            }
        );
        
        // Update individual commissions
        for (const commissionId of settlement.commissionIds) {
            await db.collection('commissions').updateOne(
                { _id: new ObjectId(commissionId) },
                {
                    $set: {
                        status: 'Paid',
                        paidAt: new Date(),
                        paymentReference: paymentReference || `PAY-${Date.now()}`,
                        updatedAt: new Date()
                    }
                }
            );
        }
        
        // Update agent stats
        await db.collection('agents').updateOne(
            { agentId: settlement.agentId },
            {
                $inc: { totalCommissionPaid: settlement.totalAmount },
                $set: { updatedAt: new Date() }
            }
        );
        
        // Log the action
        await db.collection('audit_logs').insertOne({
            action: 'COMMISSION_SETTLEMENT_PAID',
            agentId: settlement.agentId,
            settlementId: settlementId,
            totalAmount: settlement.totalAmount,
            paymentReference: paymentReference || `PAY-${Date.now()}`,
            timestamp: new Date()
        });
        
        // Create notification for agent
        await db.collection('agent_notifications').insertOne({
            agentId: settlement.agentId,
            title: 'Commission Settlement Paid',
            message: `Your commission settlement of $${settlement.totalAmount.toFixed(2)} has been paid. Reference: ${paymentReference || `PAY-${Date.now()}`}`,
            type: 'commission',
            read: false,
            createdAt: new Date(),
            link: `/commission`
        });
        
        res.json({
            success: true,
            message: 'Settlement marked as paid',
            settlement: { ...settlement, status: 'Paid', paidAt: new Date() }
        });
    } catch (error) {
        console.error('Error marking settlement as paid:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// AGENT DOCUMENTS
// ============================================================

// Get all documents for agent's applicants
app.get('/api/agent/documents', authenticateAgent, async (req, res) => {
    try {
        const agentId = req.agent.agentId;
        const { applicantId } = req.query;
        
        const query = { agentId: agentId };
        if (applicantId) {
            query.applicantId = applicantId;
        }
        
        const applicants = await db.collection('applicants')
            .find(query)
            .toArray();
        
        const allDocuments = [];
        
        for (const applicant of applicants) {
            if (applicant.documents && applicant.documents.length > 0) {
                for (const doc of applicant.documents) {
                    allDocuments.push({
                        ...doc,
                        applicantId: applicant.applicantId,
                        applicantName: applicant.fullName
                    });
                }
            }
        }
        
        // Sort by uploadedAt descending
        allDocuments.sort((a, b) => {
            return new Date(b.uploadedAt) - new Date(a.uploadedAt);
        });
        
        res.json({ success: true, documents: allDocuments, count: allDocuments.length });
    } catch (error) {
        console.error('Error fetching documents:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get documents for a specific applicant
app.get('/api/agent/applicants/:applicantId/documents', authenticateAgent, async (req, res) => {
    try {
        const agentId = req.agent.agentId;
        const { applicantId } = req.params;
        
        const applicant = await db.collection('applicants').findOne({
            applicantId: applicantId,
            agentId: agentId
        });
        
        if (!applicant) {
            return res.status(404).json({ success: false, message: 'Applicant not found' });
        }
        
        res.json({ 
            success: true, 
            documents: applicant.documents || [],
            count: (applicant.documents || []).length
        });
    } catch (error) {
        console.error('Error fetching applicant documents:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Delete a document (agent can delete their own uploaded documents)
app.delete('/api/agent/documents/:documentId', authenticateAgent, async (req, res) => {
    try {
        const agentId = req.agent.agentId;
        const { documentId } = req.params;
        
        // Find applicant containing this document
        const applicant = await db.collection('applicants').findOne({
            agentId: agentId,
            'documents.fileId': documentId
        });
        
        if (!applicant) {
            return res.status(404).json({ 
                success: false, 
                message: 'Document not found or does not belong to you' 
            });
        }
        
        // Remove document from applicant
        await db.collection('applicants').updateOne(
            { applicantId: applicant.applicantId },
            {
                $pull: { documents: { fileId: documentId } },
                $set: { updatedAt: new Date() }
            }
        );
        
        // Remove document from application
        await db.collection('applications').updateOne(
            { applicantId: applicant.applicantId },
            {
                $pull: { documents: { fileId: documentId } }
            }
        );
        
        // Note: GridFS file deletion can be added here if needed
        
        res.json({ success: true, message: 'Document deleted successfully' });
    } catch (error) {
        console.error('Error deleting document:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});


// ============================================================
// AGENT MESSAGING SYSTEM
// ============================================================

// Get all conversations for agent
app.get('/api/agent/messages/conversations', authenticateAgent, async (req, res) => {
    try {
        const agentId = req.agent.agentId;
        
        // Get all conversations where agent is participant
        const conversations = await db.collection('agent_conversations')
            .find({ agentId: agentId })
            .sort({ updatedAt: -1 })
            .toArray();
        
        // Get latest message for each conversation
        const enrichedConversations = [];
        for (const conv of conversations) {
            const messages = await db.collection('agent_messages')
                .find({ conversationId: conv._id.toString() })
                .sort({ createdAt: -1 })
                .limit(1)
                .toArray();
            
            enrichedConversations.push({
                ...conv,
                lastMessage: messages[0] || null,
                unreadCount: await db.collection('agent_messages')
                    .countDocuments({
                        conversationId: conv._id.toString(),
                        receiver: 'agent',
                        read: false
                    })
            });
        }
        
        res.json({ success: true, conversations: enrichedConversations });
    } catch (error) {
        console.error('Error fetching conversations:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get messages for a conversation
app.get('/api/agent/messages/:conversationId', authenticateAgent, async (req, res) => {
    try {
        const agentId = req.agent.agentId;
        const { conversationId } = req.params;
        
        // Verify conversation belongs to agent
        const conversation = await db.collection('agent_conversations').findOne({
            _id: new ObjectId(conversationId),
            agentId: agentId
        });
        
        if (!conversation) {
            return res.status(404).json({ 
                success: false, 
                message: 'Conversation not found' 
            });
        }
        
        // Get messages
        const messages = await db.collection('agent_messages')
            .find({ conversationId: conversationId })
            .sort({ createdAt: 1 })
            .toArray();
        
        // Mark messages as read
        await db.collection('agent_messages').updateMany(
            {
                conversationId: conversationId,
                receiver: 'agent',
                read: false
            },
            {
                $set: { read: true, readAt: new Date() }
            }
        );
        
        res.json({ success: true, messages: messages });
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Send a message
app.post('/api/agent/messages', authenticateAgent, async (req, res) => {
    try {
        const agentId = req.agent.agentId;
        const { conversationId, message, subject } = req.body;
        
        if (!message) {
            return res.status(400).json({ success: false, message: 'Message is required' });
        }
        
        const agent = await db.collection('agents').findOne({ _id: new ObjectId(req.agent.id) });
        
        let convId = conversationId;
        
        // If no conversation ID, create a new conversation
        if (!convId) {
            const newConversation = {
                agentId: agentId,
                agentName: agent.fullName,
                agentEmail: agent.email,
                subject: subject || 'Agent Inquiry',
                status: 'open',
                createdAt: new Date(),
                updatedAt: new Date()
            };
            
            const result = await db.collection('agent_conversations').insertOne(newConversation);
            convId = result.insertedId.toString();
        } else {
            // Verify conversation exists and belongs to agent
            const conv = await db.collection('agent_conversations').findOne({
                _id: new ObjectId(convId),
                agentId: agentId
            });
            
            if (!conv) {
                return res.status(404).json({ 
                    success: false, 
                    message: 'Conversation not found' 
                });
            }
            
            // Update conversation
            await db.collection('agent_conversations').updateOne(
                { _id: new ObjectId(convId) },
                { $set: { updatedAt: new Date(), status: 'open' } }
            );
        }
        
        // Create message
        const messageData = {
            conversationId: convId,
            sender: 'agent',
            senderId: agentId,
            senderName: agent.fullName,
            receiver: 'admin',
            message: message,
            read: false,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        
        const result = await db.collection('agent_messages').insertOne(messageData);
        
        res.json({
            success: true,
            messageId: result.insertedId,
            conversationId: convId,
            message: messageData
        });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Admin: Get all agent conversations
app.get('/api/admin/agent-messages/conversations', authenticateToken, async (req, res) => {
    try {
        const conversations = await db.collection('agent_conversations')
            .find({})
            .sort({ updatedAt: -1 })
            .toArray();
        
        // Get unread count for each
        const enriched = [];
        for (const conv of conversations) {
            const unreadCount = await db.collection('agent_messages')
                .countDocuments({
                    conversationId: conv._id.toString(),
                    receiver: 'admin',
                    read: false
                });
            
            const lastMessage = await db.collection('agent_messages')
                .find({ conversationId: conv._id.toString() })
                .sort({ createdAt: -1 })
                .limit(1)
                .toArray();
            
            enriched.push({
                ...conv,
                unreadCount: unreadCount,
                lastMessage: lastMessage[0] || null
            });
        }
        
        res.json({ success: true, conversations: enriched });
    } catch (error) {
        console.error('Error fetching conversations:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Admin: Get messages for a conversation
app.get('/api/admin/agent-messages/:conversationId', authenticateToken, async (req, res) => {
    try {
        const { conversationId } = req.params;
        
        const conversation = await db.collection('agent_conversations').findOne({
            _id: new ObjectId(conversationId)
        });
        
        if (!conversation) {
            return res.status(404).json({ success: false, message: 'Conversation not found' });
        }
        
        const messages = await db.collection('agent_messages')
            .find({ conversationId: conversationId })
            .sort({ createdAt: 1 })
            .toArray();
        
        // Mark admin messages as read
        await db.collection('agent_messages').updateMany(
            {
                conversationId: conversationId,
                receiver: 'admin',
                read: false
            },
            {
                $set: { read: true, readAt: new Date() }
            }
        );
        
        res.json({ success: true, messages: messages, conversation: conversation });
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Admin: Reply to agent message
app.post('/api/admin/agent-messages/:conversationId/reply', authenticateToken, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const { message } = req.body;
        
        if (!message) {
            return res.status(400).json({ success: false, message: 'Message is required' });
        }
        
        const conversation = await db.collection('agent_conversations').findOne({
            _id: new ObjectId(conversationId)
        });
        
        if (!conversation) {
            return res.status(404).json({ success: false, message: 'Conversation not found' });
        }
        
        const admin = await db.collection('admins').findOne({ _id: new ObjectId(req.user.id) });
        
        const messageData = {
            conversationId: conversationId,
            sender: 'admin',
            senderId: req.user.id,
            senderName: admin ? admin.name : 'Admin',
            receiver: 'agent',
            message: message,
            read: false,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        
        const result = await db.collection('agent_messages').insertOne(messageData);
        
        // Update conversation
        await db.collection('agent_conversations').updateOne(
            { _id: new ObjectId(conversationId) },
            { $set: { updatedAt: new Date(), status: 'open' } }
        );
        
        // Create notification for agent
        await db.collection('agent_notifications').insertOne({
            agentId: conversation.agentId,
            title: 'New Message from Admin',
            message: `You have a new message from GISC Admin regarding "${conversation.subject}"`,
            type: 'message',
            read: false,
            createdAt: new Date(),
            link: `/messages?conversation=${conversationId}`
        });
        
        res.json({ success: true, messageId: result.insertedId, message: messageData });
    } catch (error) {
        console.error('Error replying to message:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Admin: Mark conversation as closed
app.put('/api/admin/agent-messages/:conversationId/close', authenticateToken, async (req, res) => {
    try {
        const { conversationId } = req.params;
        
        const result = await db.collection('agent_conversations').updateOne(
            { _id: new ObjectId(conversationId) },
            { $set: { status: 'closed', updatedAt: new Date() } }
        );
        
        if (result.matchedCount === 0) {
            return res.status(404).json({ success: false, message: 'Conversation not found' });
        }
        
        res.json({ success: true, message: 'Conversation closed' });
    } catch (error) {
        console.error('Error closing conversation:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// AGENT NOTIFICATIONS
// ============================================================

// Get notifications for agent
app.get('/api/agent/notifications', authenticateAgent, async (req, res) => {
    try {
        const agentId = req.agent.agentId;
        const { unread, limit } = req.query;
        
        const query = { agentId: agentId };
        if (unread === 'true') {
            query.read = false;
        }
        
        let cursor = db.collection('agent_notifications')
            .find(query)
            .sort({ createdAt: -1 });
            
        if (limit) {
            cursor = cursor.limit(parseInt(limit));
        }
        
        const notifications = await cursor.toArray();
        const unreadCount = await db.collection('agent_notifications')
            .countDocuments({ agentId: agentId, read: false });
        
        res.json({
            success: true,
            notifications: notifications,
            unreadCount: unreadCount,
            total: notifications.length
        });
    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Mark notification as read
app.put('/api/agent/notifications/:notificationId/read', authenticateAgent, async (req, res) => {
    try {
        const agentId = req.agent.agentId;
        const { notificationId } = req.params;
        
        const result = await db.collection('agent_notifications').updateOne(
            { 
                _id: new ObjectId(notificationId),
                agentId: agentId
            },
            {
                $set: { read: true, readAt: new Date() }
            }
        );
        
        if (result.matchedCount === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Notification not found' 
            });
        }
        
        res.json({ success: true, message: 'Notification marked as read' });
    } catch (error) {
        console.error('Error marking notification as read:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Mark all notifications as read
app.put('/api/agent/notifications/read-all', authenticateAgent, async (req, res) => {
    try {
        const agentId = req.agent.agentId;
        
        await db.collection('agent_notifications').updateMany(
            { agentId: agentId, read: false },
            { $set: { read: true, readAt: new Date() } }
        );
        
        res.json({ success: true, message: 'All notifications marked as read' });
    } catch (error) {
        console.error('Error marking all notifications as read:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Admin: Send notification to agent
app.post('/api/admin/agent-notifications', authenticateToken, async (req, res) => {
    try {
        const { agentId, title, message, link, priority } = req.body;
        
        if (!agentId || !title || !message) {
            return res.status(400).json({ 
                success: false, 
                message: 'agentId, title, and message are required' 
            });
        }
        
        // Verify agent exists
        const agent = await db.collection('agents').findOne({ agentId: agentId });
        if (!agent) {
            return res.status(404).json({ success: false, message: 'Agent not found' });
        }
        
        const notification = {
            agentId: agentId,
            title: title,
            message: message,
            type: 'admin',
            priority: priority || 'normal',
            link: link || null,
            read: false,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        
        const result = await db.collection('agent_notifications').insertOne(notification);
        
        res.json({
            success: true,
            notificationId: result.insertedId,
            notification: notification
        });
    } catch (error) {
        console.error('Error sending notification:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Admin: Send notification to multiple agents
app.post('/api/admin/agent-notifications/bulk', authenticateToken, async (req, res) => {
    try {
        const { agentIds, title, message, link, priority } = req.body;
        
        if (!agentIds || !title || !message) {
            return res.status(400).json({ 
                success: false, 
                message: 'agentIds, title, and message are required' 
            });
        }
        
        const notifications = agentIds.map(agentId => ({
            agentId: agentId,
            title: title,
            message: message,
            type: 'admin',
            priority: priority || 'normal',
            link: link || null,
            read: false,
            createdAt: new Date(),
            updatedAt: new Date()
        }));
        
        const result = await db.collection('agent_notifications').insertMany(notifications);
        
        res.json({
            success: true,
            sentCount: result.insertedCount,
            ids: result.insertedIds
        });
    } catch (error) {
        console.error('Error sending bulk notifications:', error);
        res.status(500).json({ success: false, message: error.message });
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
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
        if (!db || !bucket) return res.status(500).json({ success: false, message: 'Database not connected' });
        
        const file = req.file;
        const userId = req.body.userId || 'unknown';
        const docType = req.body.docType || 'other';
        const fileId = Date.now().toString(36) + '_' + uuidv4();
        const fileName = `${userId}_${docType}_${fileId}_${file.originalname}`;
        
        const uploadStream = bucket.openUploadStream(fileName, {
            contentType: file.mimetype,
            metadata: { userId, docType, originalName: file.originalname, uploadedAt: new Date().toISOString(), fileSize: file.size, fileId }
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

app.get('/', (req, res) => {
    res.json({
        name: 'Global Immigration SC API',
        version: '2.0.0',
        status: 'running'
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
        if (!application) return res.status(404).json({ success: false, message: 'Application not found' });
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
        if (result.matchedCount === 0) return res.status(404).json({ success: false, message: 'Application not found' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// ADMIN BLOG ROUTES
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
        if (!blog) return res.status(404).json({ success: false, message: 'Blog not found' });
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
        if (result.matchedCount === 0) return res.status(404).json({ success: false, message: 'Blog not found' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.delete('/api/admin/blogs/:id', authenticateToken, async (req, res) => {
    try {
        const result = await db.collection('blogs').deleteOne({ _id: new ObjectId(req.params.id) });
        if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Blog not found' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// PUBLIC BLOG ROUTE
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
        if (!blog) return res.status(404).json({ success: false, message: 'Blog not found' });
        res.json({ success: true, blog });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// ADMIN CONTACT ROUTES
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
        if (!status) return res.status(400).json({ success: false, message: 'Status is required' });
        
        const validStatuses = ['new', 'read', 'replied', 'archived'];
        if (!validStatuses.includes(status)) return res.status(400).json({ success: false, message: 'Invalid status' });
        
        const result = await db.collection('contacts').updateOne(
            { _id: new ObjectId(id) },
            { $set: { status: status, updatedAt: new Date() } }
        );
        if (result.matchedCount === 0) return res.status(404).json({ success: false, message: 'Contact not found' });
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
        if (!message) return res.status(400).json({ success: false, message: 'Reply message is required' });
        
        const contact = await db.collection('contacts').findOne({ _id: new ObjectId(id) });
        if (!contact) return res.status(404).json({ success: false, message: 'Contact not found' });
        
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
        res.json({ success: true, message: 'Reply sent successfully' });
    } catch (error) {
        console.error('Error sending reply:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.delete('/api/admin/contacts/:id', authenticateToken, async (req, res) => {
    try {
        const result = await db.collection('contacts').deleteOne({ _id: new ObjectId(req.params.id) });
        if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Contact not found' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// PUBLIC CONTACT SUBMISSION
// ============================================================
app.post('/api/contacts', async (req, res) => {
    try {
        const { name, email, phone, country, interest, message, form_type } = req.body;
        if (!name || !email || !phone || !country || !interest || !message) {
            return res.status(400).json({ success: false, message: 'All fields are required' });
        }
        
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) return res.status(400).json({ success: false, message: 'Invalid email format' });
        
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
        res.json({ success: true, message: 'Your message has been sent successfully!' });
    } catch (error) {
        console.error('❌ Error saving contact:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// USER API ENDPOINTS
// ============================================================
app.post('/api/users/register', async (req, res) => {
    try {
        const { uid, name, email, phone, whatsapp, dob, citizenship, countryOfInterest, referral, receiveUpdates, userType, accountStatus } = req.body;
        if (!uid || !email) return res.status(400).json({ success: false, message: 'uid and email are required' });
        
        const existingUser = await db.collection('users').findOne({ uid: uid });
        if (existingUser) return res.status(200).json({ success: true, message: 'User already exists', user: existingUser });
        
        const existingEmail = await db.collection('users').findOne({ email: email });
        if (existingEmail) return res.status(400).json({ success: false, message: 'Email already registered' });
        
        const userData = {
            uid, name: name || 'Unknown', email, phone: phone || '', whatsapp: whatsapp || phone || '',
            dob: dob || '', citizenship: citizenship || '', countryOfInterest: countryOfInterest || '',
            referral: referral || '', receiveUpdates: receiveUpdates || false,
            userType: userType || 'applicant', accountStatus: accountStatus || 'active',
            highest_qualification: '', field_of_study: '', gpa: null, graduation_year: null,
            intended_programme: '', degree_level: '', preferred_intake: '', education_budget: '',
            scholarship_required: false, fully_funded_preferred: false,
            partial_scholarship_acceptable: false, student_loan_interest: false,
            work_experience: '', occupation: '', career_goal: '',
            profile_completion: 0, recommendations_generated_at: null,
            createdAt: new Date(), updatedAt: new Date()
        };
        const result = await db.collection('users').insertOne(userData);
        const applicationData = {
            userId: uid, uid: uid, status: 'draft', progress: 0, currentStep: 'personal_info',
            personalInfo: { name: name || 'Unknown', email: email, phone: phone || '', countryOfInterest: countryOfInterest || '' },
            documents: {}, payments: [], notifications: [], uploadHistory: [],
            paymentReceipt: null, service_requests: [], recommendation_ids: [], cost_estimates: null,
            applicationStages: {
                personal_info: { completed: true, status: 'completed', completedAt: new Date() },
                document_upload: { completed: false, status: 'pending' },
                payment: { completed: false, status: 'pending' },
                review: { completed: false, status: 'pending' },
                approval: { completed: false, status: 'pending' }
            },
            createdAt: new Date(), updatedAt: new Date()
        };
        await db.collection('applications').insertOne(applicationData);
        res.json({ success: true, message: 'User registered successfully', user: { ...userData, _id: result.insertedId } });
    } catch (error) {
        console.error('❌ User registration error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.put('/api/users/notifications', async (req, res) => {
    try {
        const { uid, notifications } = req.body;
        if (!uid) return res.status(400).json({ success: false, message: 'uid is required' });
        
        let application = await db.collection('applications').findOne({ uid: uid });
        if (!application) {
            const user = await db.collection('users').findOne({ uid: uid });
            if (!user) return res.status(404).json({ success: false, message: 'User not found' });
            const newApp = {
                uid: uid, userId: uid, status: 'draft', progress: 0, currentStep: 'personal_info',
                personalInfo: { name: user.name || 'Unknown', email: user.email || '', phone: user.phone || '', countryOfInterest: user.countryOfInterest || '' },
                documents: {}, payments: [], notifications: notifications || [], uploadHistory: [],
                paymentReceipt: null, service_requests: [], recommendation_ids: [], cost_estimates: null,
                createdAt: new Date(), updatedAt: new Date(),
                applicationStages: {
                    personal_info: { completed: true, status: 'completed', completedAt: new Date() },
                    document_upload: { completed: false, status: 'pending' },
                    payment: { completed: false, status: 'pending' },
                    review: { completed: false, status: 'pending' },
                    approval: { completed: false, status: 'pending' }
                }
            };
            await db.collection('applications').insertOne(newApp);
            return res.json({ success: true, message: 'Application created and notifications updated' });
        }
        await db.collection('applications').updateOne(
            { uid: uid },
            { $set: { notifications: notifications || [], updatedAt: new Date() } }
        );
        res.json({ success: true, message: 'Notifications updated' });
    } catch (error) {
        console.error('Error updating notifications:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/users/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        const user = await db.collection('users').findOne({ uid: uid });
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/users/:uid/full', async (req, res) => {
    try {
        const { uid } = req.params;
        const user = await db.collection('users').findOne({ uid: uid });
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        const application = await db.collection('applications').findOne({ uid: uid });
        res.json({ success: true, user: user, application: application || null });
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
        if (result.matchedCount === 0) return res.status(404).json({ success: false, message: 'User not found' });
        res.json({ success: true, message: 'User updated' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// DOCUMENT ENDPOINTS
// ============================================================
app.post('/api/users/documents', async (req, res) => {
    try {
        const { uid, docType, fileId, fileName, fileSize, fileType, fileUrl, status, uploadedAt } = req.body;
        if (!uid || !fileId || !docType) return res.status(400).json({ success: false, message: 'uid, fileId, and docType are required' });
        
        const user = await db.collection('users').findOne({ uid: uid });
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        
        let application = await db.collection('applications').findOne({ uid: uid });
        if (!application) {
            const newApp = {
                uid: uid, userId: uid, status: 'draft', progress: 0, currentStep: 'document_upload',
                personalInfo: { name: user.name || 'Unknown', email: user.email || '', phone: user.phone || '', countryOfInterest: user.countryOfInterest || '' },
                documents: {}, payments: [], notifications: [], uploadHistory: [],
                paymentReceipt: null, service_requests: [], recommendation_ids: [], cost_estimates: null,
                createdAt: new Date(), updatedAt: new Date(),
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
            fileId, fileName: fileName || 'Unknown', fileSize: fileSize || 0,
            fileType: fileType || 'application/octet-stream', fileUrl: fileUrl || '',
            status: status || 'pending_review', uploadedAt: uploadedAt || new Date().toISOString()
        };
        
        const updatePath = `documents.${docType}`;
        await db.collection('applications').updateOne(
            { uid: uid },
            {
                $set: { [updatePath]: docData, updatedAt: new Date() },
                $push: {
                    uploadHistory: {
                        filename: fileName || 'Unknown', docType: docType,
                        timestamp: new Date().toISOString(), status: 'submitted',
                        fileId: fileId, fileUrl: fileUrl
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

app.post('/api/users/documents/multiple', async (req, res) => {
    try {
        const { uid, docType, document } = req.body;
        if (!uid || !docType || !document) return res.status(400).json({ success: false, message: 'Missing required fields' });
        
        const collection = db.collection('applications');
        let application = await collection.findOne({ uid: uid });
        if (!application) {
            application = await collection.findOne({ userId: uid });
            if (!application) return res.status(404).json({ success: false, message: 'Application not found for user' });
        }
        
        let currentDocs = application.documents || {};
        let existing = currentDocs[docType] || [];
        if (!Array.isArray(existing)) existing = [];
        existing.push(document);
        currentDocs[docType] = existing;
        
        await collection.updateOne(
            { _id: application._id },
            {
                $set: { documents: currentDocs, updatedAt: new Date().toISOString() },
                $push: {
                    uploadHistory: {
                        filename: document.fileName || 'Unknown', docType: docType,
                        timestamp: new Date().toISOString(), status: 'submitted',
                        fileId: document.fileId, fileUrl: document.fileUrl
                    }
                }
            }
        );
        res.json({ success: true, message: 'Document added successfully', count: existing.length });
    } catch (error) {
        console.error('Error adding multiple document:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/users/application', async (req, res) => {
    try {
        const appData = req.body;
        if (!appData.uid) return res.status(400).json({ success: false, message: 'uid is required' });
        
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
        if (!uid) return res.status(400).json({ success: false, message: 'uid is required' });
        
        const updateData = { updatedAt: new Date() };
        if (applicationStages) updateData.applicationStages = applicationStages;
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

app.post('/api/users/payment-receipt', async (req, res) => {
    try {
        const { uid, receiptUrl, receiptFileId, receiptFileName, uploadedAt, status, amount } = req.body;
        if (!uid || !receiptUrl) return res.status(400).json({ success: false, message: 'uid and receiptUrl are required' });
        
        let application = await db.collection('applications').findOne({ uid: uid });
        if (!application) {
            const user = await db.collection('users').findOne({ uid: uid });
            if (!user) return res.status(404).json({ success: false, message: 'User not found' });
            const newApp = {
                uid: uid, userId: uid, status: 'draft', progress: 0, currentStep: 'payment',
                personalInfo: { name: user.name || 'Unknown', email: user.email || '', phone: user.phone || '', countryOfInterest: user.countryOfInterest || '' },
                documents: {}, payments: [], notifications: [], uploadHistory: [],
                paymentReceipt: null, service_requests: [], recommendation_ids: [], cost_estimates: null,
                createdAt: new Date(), updatedAt: new Date(),
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
            { $pull: { payments: { status: 'pending' } } }
        );
        
        const receiptData = {
            receiptUrl, receiptFileId, receiptFileName: receiptFileName || 'receipt',
            uploadedAt: uploadedAt || new Date().toISOString(), status: 'pending_verification',
            amount: amount || 0
        };
        
        await db.collection('applications').updateOne(
            { uid: uid },
            {
                $set: { paymentReceipt: receiptData, updatedAt: new Date(), status: 'payment_pending' },
                $push: {
                    payments: {
                        amount: amount || 0, status: 'pending',
                        description: `Payment receipt uploaded: $${(amount || 0).toFixed(2)}`,
                        receiptUrl: receiptUrl, uploadedAt: uploadedAt || new Date().toISOString()
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
        if (!title || !message) return res.status(400).json({ success: false, message: 'Title and message are required' });
        
        const notification = {
            title, message, recipientType: recipientType || 'all', priority: priority || 'normal',
            sender: sender || 'Admin', senderEmail: senderEmail || 'admin@globalimmigrationsc.com',
            read: false, createdAt: new Date(), updatedAt: new Date()
        };
        if (specificEmail) notification.specificEmail = specificEmail;
        
        const result = await db.collection('notifications').insertOne(notification);
        const users = await db.collection('users').find({}).toArray();
        let recipientCount = 0;
        for (const user of users) {
            if (specificEmail && user.email !== specificEmail) continue;
            if (recipientType === 'applicants' && user.userType !== 'applicant') continue;
            if (recipientType === 'students' && user.userType !== 'student') continue;
            const userNotif = {
                id: result.insertedId.toString(),
                title: title, message: message, priority: priority || 'normal',
                sender: sender || 'Admin', read: false,
                createdAt: new Date().toISOString()
            };
            await db.collection('applications').updateOne(
                { uid: user.uid },
                { $push: { notifications: userNotif }, $set: { updatedAt: new Date() } }
            );
            recipientCount++;
        }
        res.json({ success: true, id: result.insertedId, notification, recipientCount });
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
        if (result.matchedCount === 0) return res.status(404).json({ success: false, message: 'Notification not found' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.delete('/api/admin/notifications/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db.collection('notifications').deleteOne({ _id: new ObjectId(id) });
        await db.collection('applications').updateMany({}, { $pull: { notifications: { id: id } } });
        if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Notification not found' });
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
        if (!uid) return res.status(400).json({ success: false, message: 'uid is required' });

        const application = await db.collection('applications').findOne({ uid: uid });
        if (!application) return res.status(404).json({ success: false, message: 'Application not found' });

        const receipt = application.paymentReceipt || {};
        const amount = receipt.amount || 0;

        const updatedReceipt = { ...receipt, status: 'verified', verifiedAt: new Date().toISOString(), verifiedBy: req.user?.email || 'admin' };
        const pendingPaymentIndex = application.payments?.findIndex(p => p.status === 'pending') || -1;
        
        let updateQuery = {
            $set: {
                paymentReceipt: updatedReceipt,
                status: 'payment_confirmed',
                updatedAt: new Date(),
                'applicationStages.payment': { completed: true, status: 'completed', completedAt: new Date().toISOString() }
            }
        };

        if (pendingPaymentIndex !== -1) {
            const updatePath = `payments.${pendingPaymentIndex}`;
            updateQuery.$set[updatePath] = {
                amount: amount, status: 'completed',
                description: `Payment confirmed by admin. Amount: $${amount.toFixed(2)}`,
                receiptUrl: receipt.receiptUrl || '',
                confirmedAt: new Date().toISOString(),
                confirmedBy: req.user?.email || 'admin'
            };
        } else {
            updateQuery.$push = {
                payments: {
                    amount: amount, status: 'completed',
                    description: `Payment confirmed by admin. Amount: $${amount.toFixed(2)}`,
                    receiptUrl: receipt.receiptUrl || '',
                    confirmedAt: new Date().toISOString(),
                    confirmedBy: req.user?.email || 'admin'
                }
            };
        }

        await db.collection('applications').updateOne({ uid: uid }, updateQuery);
        res.json({ success: true, message: 'Payment confirmed successfully', amount: amount });
    } catch (error) {
        console.error('Error confirming payment:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.put('/api/admin/payments/pending', authenticateToken, async (req, res) => {
    try {
        const { uid } = req.body;
        if (!uid) return res.status(400).json({ success: false, message: 'uid is required' });

        const application = await db.collection('applications').findOne({ uid: uid });
        if (!application) return res.status(404).json({ success: false, message: 'Application not found' });

        const receipt = application.paymentReceipt || {};
        const amount = receipt.amount || 0;

        const updatedReceipt = { ...receipt, status: 'pending_verification', pendingAt: new Date().toISOString() };

        await db.collection('applications').updateOne(
            { uid: uid },
            { $pull: { payments: { status: { $in: ['completed', 'rejected'] } } } }
        );

        const hasPending = application.payments?.some(p => p.status === 'pending');
        let updateQuery = {
            $set: { paymentReceipt: updatedReceipt, status: 'payment_pending', updatedAt: new Date() }
        };

        if (!hasPending && receipt.receiptUrl) {
            updateQuery.$push = {
                payments: {
                    amount: amount, status: 'pending',
                    description: `Payment pending verification. Amount: $${amount.toFixed(2)}`,
                    receiptUrl: receipt.receiptUrl || '',
                    pendingAt: new Date().toISOString()
                }
            };
        }

        await db.collection('applications').updateOne({ uid: uid }, updateQuery);
        res.json({ success: true, message: 'Payment marked as pending', amount: amount });
    } catch (error) {
        console.error('Error marking payment pending:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.put('/api/admin/payments/reject', authenticateToken, async (req, res) => {
    try {
        const { uid, reason } = req.body;
        if (!uid) return res.status(400).json({ success: false, message: 'uid is required' });

        const application = await db.collection('applications').findOne({ uid: uid });
        if (!application) return res.status(404).json({ success: false, message: 'Application not found' });

        const receipt = application.paymentReceipt || {};
        const amount = receipt.amount || 0;

        const updatedReceipt = { ...receipt, status: 'rejected', rejectionReason: reason || 'Invalid receipt', rejectedAt: new Date().toISOString(), rejectedBy: req.user?.email || 'admin' };

        await db.collection('applications').updateOne(
            { uid: uid },
            { $pull: { payments: { status: { $in: ['pending', 'completed'] } } } }
        );

        await db.collection('applications').updateOne(
            { uid: uid },
            {
                $set: { paymentReceipt: updatedReceipt, status: 'payment_rejected', updatedAt: new Date() },
                $push: {
                    payments: {
                        amount: amount, status: 'rejected',
                        description: `Payment rejected. Reason: ${reason || 'Invalid receipt'}. Amount: $${amount.toFixed(2)}`,
                        receiptUrl: receipt.receiptUrl || '',
                        rejectedAt: new Date().toISOString(),
                        rejectedBy: req.user?.email || 'admin'
                    }
                }
            }
        );

        res.json({ success: true, message: 'Payment rejected successfully' });
    } catch (error) {
        console.error('Error rejecting payment:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.delete('/api/admin/payments/delete', authenticateToken, async (req, res) => {
    try {
        const { uid } = req.body;
        if (!uid) return res.status(400).json({ success: false, message: 'uid is required' });

        const application = await db.collection('applications').findOne({ uid: uid });
        if (!application) return res.status(404).json({ success: false, message: 'Application not found' });

        await db.collection('applications').updateOne(
            { uid: uid },
            {
                $set: { paymentReceipt: null, status: 'draft', updatedAt: new Date() },
                $pull: { payments: { status: { $in: ['pending', 'completed', 'rejected'] } } }
            }
        );

        await db.collection('applications').updateOne(
            { uid: uid },
            {
                $set: {
                    'applicationStages.payment': { completed: false, status: 'pending' },
                    updatedAt: new Date()
                }
            }
        );

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
        const query = {};
        if (country) query.country = country;
        if (degree_level) query.degree_level = degree_level;
        if (field) query.field = { $regex: field, $options: 'i' };
        if (status) query.status = status;
        
        let cursor = db.collection('opportunities').find(query).sort({ created_at: -1 });
        if (limit) cursor = cursor.limit(parseInt(limit));
        
        const opportunities = await cursor.toArray();
        res.json({ success: true, opportunities, count: opportunities.length });
    } catch (error) {
        console.error('Error loading opportunities:', error);
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
        const query = {};
        if (country) query.country = country;
        if (degree_level) query.degree_level = degree_level;
        if (field) query.field = { $regex: field, $options: 'i' };
        if (status) query.status = status;
        
        let cursor = db.collection('scholarships').find(query).sort({ deadline: 1 });
        if (limit) cursor = cursor.limit(parseInt(limit));
        
        const scholarships = await cursor.toArray();
        res.json({ success: true, scholarships, count: scholarships.length });
    } catch (error) {
        console.error('Error loading scholarships:', error);
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
        const query = {};
        if (country) query.country = country;
        if (partner_status) query.partner_status = partner_status;
        
        let cursor = db.collection('universities').find(query).sort({ name: 1 });
        if (limit) cursor = cursor.limit(parseInt(limit));
        
        const universities = await cursor.toArray();
        res.json({ success: true, universities, count: universities.length });
    } catch (error) {
        console.error('Error loading universities:', error);
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
        const query = {};
        if (country) query.country = country;
        if (degree) query.degree = degree;
        if (field) query.field = { $regex: field, $options: 'i' };
        if (institution) query.institution = { $regex: institution, $options: 'i' };
        
        let cursor = db.collection('programmes').find(query).sort({ name: 1 });
        if (limit) cursor = cursor.limit(parseInt(limit));
        
        const programmes = await cursor.toArray();
        res.json({ success: true, programmes, count: programmes.length });
    } catch (error) {
        console.error('Error loading programmes:', error);
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
            source_date: opportunity.source_date || null,
            total: (opportunity.tuition || 0) + (opportunity.accommodation_cost || 0) + (opportunity.estimated_living_cost || 0) - (opportunity.scholarship_amount || 0)
        };
        
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
            let eligible = true;
            if (opp.degree_level === 'Master' && !user.highest_qualification) eligible = false;
            if (opp.degree_level === 'PhD' && user.highest_qualification !== 'Master\'s Degree' && user.highest_qualification !== 'PhD') eligible = false;
            if (!eligible) continue;
            
            let academicMatch = 0.5;
            if (user.field_of_study && opp.field) {
                const userFields = user.field_of_study.toLowerCase().split(/[, ]+/);
                const oppFields = opp.field.toLowerCase().split(/[, ]+/);
                const match = userFields.some(f => oppFields.some(o => f.includes(o) || o.includes(f)));
                academicMatch = match ? 0.8 : 0.3;
            }
            
            let programmeMatch = 0.4;
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
            }
            
            const budgetMap = {
                'under_2000': 2000,
                '2000_5000': 5000,
                '5000_10000': 10000,
                '10000_20000': 20000,
                '20000_plus': 30000
            };
            const budget = budgetMap[user.education_budget] || 10000;
            const totalCost = (opp.tuition || 0) + (opp.estimated_living_cost || 0);
            let financialMatch = 0.2;
            if (totalCost <= budget) financialMatch = 1;
            else if (totalCost <= budget * 1.3) financialMatch = 0.7;
            else if (totalCost <= budget * 1.6) financialMatch = 0.4;
            
            let scholarshipMatch = 0.3;
            if (user.scholarship_required) {
                if (opp.scholarship_type === 'full') scholarshipMatch = 1;
                else if (opp.scholarship_type === 'partial') scholarshipMatch = 0.7;
                else if (opp.scholarship_type === 'tuition_waiver') scholarshipMatch = 0.5;
                else scholarshipMatch = 0.1;
            } else {
                scholarshipMatch = opp.scholarship_type && opp.scholarship_type !== 'none' ? 0.5 : 0.3;
            }
            
            let countryMatch = 0.5;
            if (user.countryOfInterest && opp.country) {
                if (user.countryOfInterest === opp.country) countryMatch = 1;
                else countryMatch = 0.3;
            }
            
            let intakeMatch = 0.5;
            if (user.preferred_intake && opp.intake) {
                const pIntake = user.preferred_intake.toLowerCase();
                const oIntake = opp.intake.toLowerCase();
                if (pIntake.includes(oIntake) || oIntake.includes(pIntake)) intakeMatch = 1;
                else intakeMatch = 0.3;
            }
            
            const weights = { academic: 0.30, programme: 0.20, financial: 0.20, scholarship: 0.15, country: 0.10, intake: 0.05 };
            
            const totalScore = (academicMatch * weights.academic) +
                              (programmeMatch * weights.programme) +
                              (financialMatch * weights.financial) +
                              (scholarshipMatch * weights.scholarship) +
                              (countryMatch * weights.country) +
                              (intakeMatch * weights.intake);
            
            const reasons = [];
            if (academicMatch > 0.7) reasons.push('Your academic background matches the programme requirements');
            if (programmeMatch > 0.7) reasons.push('The programme aligns with your stated interests');
            if (financialMatch > 0.7) reasons.push('The estimated costs are within your stated budget');
            if (scholarshipMatch > 0.7) reasons.push('The scholarship opportunities match your needs');
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
        const query = { uid: uid, match_category: { $in: ['strong', 'good'] } };
        
        const recommendations = await db.collection('recommendations')
            .find(query)
            .sort({ match_score: -1 })
            .toArray();
        
        const enriched = [];
        for (const rec of recommendations) {
            const opp = await db.collection('opportunities').findOne({ _id: rec.opportunity_id });
            if (opp) {
                enriched.push({ ...rec, opportunity: opp });
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
app.get('/api/admin/opportunities', authenticateToken, async (req, res) => {
    try {
        const opportunities = await db.collection('opportunities').find({}).sort({ created_at: -1 }).toArray();
        res.json({ success: true, opportunities });
    } catch (error) {
        console.error('Error loading admin opportunities:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/opportunities', authenticateToken, async (req, res) => {
    try {
        const opportunity = { ...req.body, created_at: new Date(), updated_at: new Date() };
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
app.get('/api/admin/scholarships', authenticateToken, async (req, res) => {
    try {
        const scholarships = await db.collection('scholarships').find({}).sort({ created_at: -1 }).toArray();
        res.json({ success: true, scholarships });
    } catch (error) {
        console.error('Error loading admin scholarships:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/scholarships', authenticateToken, async (req, res) => {
    try {
        const scholarship = { ...req.body, created_at: new Date(), updated_at: new Date() };
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
app.get('/api/admin/universities', authenticateToken, async (req, res) => {
    try {
        const universities = await db.collection('universities').find({}).sort({ name: 1 }).toArray();
        res.json({ success: true, universities });
    } catch (error) {
        console.error('Error loading admin universities:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/universities', authenticateToken, async (req, res) => {
    try {
        const university = { ...req.body, created_at: new Date(), updated_at: new Date() };
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
app.get('/api/admin/programmes', authenticateToken, async (req, res) => {
    try {
        const programmes = await db.collection('programmes').find({}).sort({ name: 1 }).toArray();
        res.json({ success: true, programmes });
    } catch (error) {
        console.error('Error loading admin programmes:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/programmes', authenticateToken, async (req, res) => {
    try {
        const programme = { ...req.body, created_at: new Date(), updated_at: new Date() };
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
        console.error('Error loading service requests:', error);
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
// AGENT REPORTING
// ============================================================

// Agent performance report
app.get('/api/agent/performance', authenticateAgent, async (req, res) => {
    try {
        const agentId = req.agent.agentId;
        
        // Get agent data
        const agent = await db.collection('agents').findOne({ _id: new ObjectId(req.agent.id) });
        if (!agent) {
            return res.status(404).json({ success: false, message: 'Agent not found' });
        }
        
        // Get all applicants
        const applicants = await db.collection('applicants')
            .find({ agentId: agentId })
            .toArray();
        
        // Get all applications
        const applicantIds = applicants.map(a => a.applicantId);
        const applications = await db.collection('applications')
            .find({ applicantId: { $in: applicantIds } })
            .toArray();
        
        // Get all commissions
        const commissions = await db.collection('commissions')
            .find({ agentId: agentId })
            .toArray();
        
        // Calculate metrics
        const totalApplicants = applicants.length;
        const qualifiedApplicants = applicants.filter(a => a.status === 'Qualified').length;
        const successfulApplications = applications.filter(a => a.status === 'Completed').length;
        
        // Monthly breakdown
        const monthlyData = [];
        const now = new Date();
        for (let i = 0; i < 6; i++) {
            const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
            
            const monthApplicants = applicants.filter(a => {
                const date = new Date(a.createdAt);
                return date >= monthStart && date <= monthEnd;
            });
            
            const monthCommissions = commissions.filter(c => {
                const date = new Date(c.createdAt);
                return date >= monthStart && date <= monthEnd;
            });
            
            const monthRevenue = monthCommissions.reduce((sum, c) => sum + c.eligibleRevenue, 0);
            const monthCommission = monthCommissions.reduce((sum, c) => sum + c.commissionAmount, 0);
            
            monthlyData.push({
                month: monthStart.toLocaleString('default', { month: 'short', year: 'numeric' }),
                applicants: monthApplicants.length,
                revenue: monthRevenue,
                commission: monthCommission
            });
        }
        
        // Performance level calculation
        const successCount = successfulApplications;
        let performanceLevel = 'Registered Agent';
        let nextLevel = 'ACTIVE AGENT';
        let nextLevelThreshold = 3;
        let progressToNext = 0;
        
        if (successCount >= 25) {
            performanceLevel = 'ELITE AGENT';
            nextLevel = 'ELITE+';
            nextLevelThreshold = 30;
            progressToNext = Math.min((successCount - 25) / 5 * 100, 100);
        } else if (successCount >= 10) {
            performanceLevel = 'PREMIUM AGENT';
            nextLevel = 'ELITE AGENT';
            nextLevelThreshold = 25;
            progressToNext = (successCount - 10) / 15 * 100;
        } else if (successCount >= 3) {
            performanceLevel = 'ACTIVE AGENT';
            nextLevel = 'PREMIUM AGENT';
            nextLevelThreshold = 10;
            progressToNext = (successCount - 3) / 7 * 100;
        } else {
            performanceLevel = 'REGISTERED AGENT';
            nextLevel = 'ACTIVE AGENT';
            nextLevelThreshold = 3;
            progressToNext = successCount / 3 * 100;
        }
        
        // Bonus eligibility
        let bonuses = [];
        if (successCount >= 5) bonuses.push({ type: 'Milestone Bonus', amount: 50, achieved: true });
        if (successCount >= 10) bonuses.push({ type: 'Milestone Bonus', amount: 150, achieved: true });
        if (successCount >= 20) bonuses.push({ type: 'Milestone Bonus', amount: 350, achieved: true });
        if (successCount >= 30) bonuses.push({ type: 'Elite Bonus', amount: 500, achieved: successCount >= 30 });
        
        // Commission breakdown by package
        const packageBreakdown = {};
        for (const c of commissions) {
            if (c.packageName) {
                if (!packageBreakdown[c.packageName]) {
                    packageBreakdown[c.packageName] = {
                        count: 0,
                        totalCommission: 0,
                        totalRevenue: 0
                    };
                }
                packageBreakdown[c.packageName].count++;
                packageBreakdown[c.packageName].totalCommission += c.commissionAmount;
                packageBreakdown[c.packageName].totalRevenue += c.eligibleRevenue;
            }
        }
        
        res.json({
            success: true,
            performance: {
                agent: {
                    name: agent.fullName,
                    agentId: agent.agentId,
                    category: agent.agentCategory,
                    status: agent.status,
                    joinedDate: agent.createdAt
                },
                metrics: {
                    totalApplicants,
                    qualifiedApplicants,
                    successfulApplications,
                    conversionRate: totalApplicants > 0 ? (qualifiedApplicants / totalApplicants * 100) : 0,
                    successRate: qualifiedApplicants > 0 ? (successfulApplications / qualifiedApplicants * 100) : 0
                },
                level: {
                    current: performanceLevel,
                    next: nextLevel,
                    threshold: nextLevelThreshold,
                    progress: Math.min(progressToNext, 100)
                },
                commissions: {
                    totalEarned: commissions.reduce((sum, c) => sum + (c.status === 'Reversed' ? 0 : c.commissionAmount), 0),
                    totalPaid: commissions.filter(c => c.status === 'Paid' || c.status === 'Settled').reduce((sum, c) => sum + c.commissionAmount, 0),
                    totalPending: commissions.filter(c => c.status === 'Pending' || c.status === 'Eligible').reduce((sum, c) => sum + c.commissionAmount, 0),
                    totalReversed: commissions.filter(c => c.status === 'Reversed').reduce((sum, c) => sum + c.commissionAmount, 0)
                },
                monthlyData: monthlyData.reverse(),
                packageBreakdown: Object.keys(packageBreakdown).map(name => ({
                    package: name,
                    ...packageBreakdown[name]
                })),
                bonuses: bonuses
            }
        });
    } catch (error) {
        console.error('Error fetching performance:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Admin: Agent performance report
app.get('/api/admin/reports/agent-performance', authenticateToken, async (req, res) => {
    try {
        const { agentId, period } = req.query;
        
        const query = {};
        if (agentId) query.agentId = agentId;
        
        const agents = await db.collection('agents')
            .find(query)
            .toArray();
        
        const results = [];
        
        for (const agent of agents) {
            const applicants = await db.collection('applicants')
                .find({ agentId: agent.agentId })
                .toArray();
            
            const applicantIds = applicants.map(a => a.applicantId);
            const applications = await db.collection('applications')
                .find({ applicantId: { $in: applicantIds } })
                .toArray();
            
            const commissions = await db.collection('commissions')
                .find({ agentId: agent.agentId })
                .toArray();
            
            results.push({
                agent: {
                    id: agent.agentId,
                    name: agent.fullName,
                    email: agent.email,
                    category: agent.agentCategory,
                    status: agent.status,
                    joinedDate: agent.createdAt
                },
                metrics: {
                    totalApplicants: applicants.length,
                    qualifiedApplicants: applicants.filter(a => a.status === 'Qualified').length,
                    successfulApplications: applications.filter(a => a.status === 'Completed').length,
                    totalRevenue: commissions.reduce((sum, c) => sum + c.eligibleRevenue, 0),
                    totalCommission: commissions.reduce((sum, c) => sum + (c.status === 'Reversed' ? 0 : c.commissionAmount), 0),
                    pendingCommission: commissions.filter(c => c.status === 'Eligible' || c.status === 'Pending').reduce((sum, c) => sum + c.commissionAmount, 0),
                    paidCommission: commissions.filter(c => c.status === 'Paid' || c.status === 'Settled').reduce((sum, c) => sum + c.commissionAmount, 0)
                }
            });
        }
        
        res.json({ success: true, reports: results });
    } catch (error) {
        console.error('Error generating agent performance report:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Admin: Commission report
app.get('/api/admin/reports/commission', authenticateToken, async (req, res) => {
    try {
        const { agentId, status, startDate, endDate } = req.query;
        
        const query = {};
        if (agentId) query.agentId = agentId;
        if (status) query.status = status;
        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) query.createdAt.$lte = new Date(endDate);
        }
        
        const commissions = await db.collection('commissions')
            .find(query)
            .sort({ createdAt: -1 })
            .toArray();
        
        // Enrich with agent and applicant names
        const enriched = [];
        for (const c of commissions) {
            const agent = await db.collection('agents').findOne({ agentId: c.agentId });
            const applicant = await db.collection('applicants').findOne({ applicantId: c.applicantId });
            enriched.push({
                ...c,
                agentName: agent ? agent.fullName : 'Unknown Agent',
                applicantName: applicant ? applicant.fullName : 'Unknown Applicant'
            });
        }
        
        // Summary
        const summary = {
            totalAmount: enriched.reduce((sum, c) => sum + (c.status === 'Reversed' ? 0 : c.commissionAmount), 0),
            totalEligible: enriched.filter(c => c.status === 'Eligible').reduce((sum, c) => sum + c.commissionAmount, 0),
            totalPaid: enriched.filter(c => c.status === 'Paid' || c.status === 'Settled').reduce((sum, c) => sum + c.commissionAmount, 0),
            totalReversed: enriched.filter(c => c.status === 'Reversed').reduce((sum, c) => sum + c.commissionAmount, 0),
            count: enriched.length
        };
        
        res.json({
            success: true,
            commissions: enriched,
            summary: summary
        });
    } catch (error) {
        console.error('Error generating commission report:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Admin: Applicant acquisition report
app.get('/api/admin/reports/applicant-acquisition', authenticateToken, async (req, res) => {
    try {
        const { agentId, startDate, endDate } = req.query;
        
        const query = {};
        if (agentId) query.agentId = agentId;
        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) query.createdAt.$lte = new Date(endDate);
        }
        
        const applicants = await db.collection('applicants')
            .find(query)
            .toArray();
        
        // Group by agent
        const agentGroups = {};
        for (const a of applicants) {
            if (!agentGroups[a.agentId]) {
                agentGroups[a.agentId] = {
                    agentId: a.agentId,
                    agentReferralCode: a.agentReferralCode || 'N/A',
                    count: 0,
                    applicants: []
                };
            }
            agentGroups[a.agentId].count++;
            agentGroups[a.agentId].applicants.push(a);
        }
        
        // Get agent names
        const agentIds = Object.keys(agentGroups);
        const agents = await db.collection('agents')
            .find({ agentId: { $in: agentIds } })
            .toArray();
        const agentMap = {};
        for (const a of agents) {
            agentMap[a.agentId] = a.fullName;
        }
        
        const results = Object.keys(agentGroups).map(agentId => ({
            agentId: agentId,
            agentName: agentMap[agentId] || 'Unknown Agent',
            referralCode: agentGroups[agentId].agentReferralCode,
            count: agentGroups[agentId].count,
            applicants: agentGroups[agentId].applicants
        }));
        
        results.sort((a, b) => b.count - a.count);
        
        res.json({
            success: true,
            results: results,
            totalApplicants: applicants.length,
            totalAgents: results.length
        });
    } catch (error) {
        console.error('Error generating applicant acquisition report:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// AGENT RESOURCES
// ============================================================

// Get resources for agent
app.get('/api/agent/resources', authenticateAgent, async (req, res) => {
    try {
        const resources = await db.collection('agent_resources')
            .find({ status: 'published' })
            .sort({ createdAt: -1 })
            .toArray();
        
        res.json({ success: true, resources });
    } catch (error) {
        console.error('Error fetching resources:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Admin: Manage resources
app.get('/api/admin/resources', authenticateToken, async (req, res) => {
    try {
        const resources = await db.collection('agent_resources')
            .find({})
            .sort({ createdAt: -1 })
            .toArray();
        res.json({ success: true, resources });
    } catch (error) {
        console.error('Error fetching resources:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/resources', authenticateToken, async (req, res) => {
    try {
        const resource = {
            ...req.body,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        const result = await db.collection('agent_resources').insertOne(resource);
        res.json({ success: true, id: result.insertedId, resource });
    } catch (error) {
        console.error('Error creating resource:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.put('/api/admin/resources/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = { ...req.body, updatedAt: new Date() };
        delete updateData._id;
        delete updateData.createdAt;
        
        const result = await db.collection('agent_resources').updateOne(
            { _id: new ObjectId(id) },
            { $set: updateData }
        );
        if (result.matchedCount === 0) {
            return res.status(404).json({ success: false, message: 'Resource not found' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating resource:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.delete('/api/admin/resources/:id', authenticateToken, async (req, res) => {
    try {
        const result = await db.collection('agent_resources').deleteOne({ _id: new ObjectId(req.params.id) });
        if (result.deletedCount === 0) {
            return res.status(404).json({ success: false, message: 'Resource not found' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting resource:', error);
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
