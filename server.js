// server.js - Add this to your Railway backend
const express = require('express');
const multer = require('multer');
const admin = require('firebase-admin');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: "global-immigration-sc",
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  }),
  storageBucket: "global-immigration-sc.firebasestorage.app"
});

const bucket = admin.storage().bucket();

// File upload endpoint
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    const userId = req.body.userId;
    const docType = req.body.docType || 'other';
    
    if (!file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const fileName = `${userId}/${docType}_${Date.now()}_${file.originalname}`;
    const fileRef = bucket.file(fileName);
    
    await fileRef.save(file.buffer, {
      metadata: {
        contentType: file.mimetype,
        metadata: {
          userId: userId,
          docType: docType,
          uploadedAt: new Date().toISOString()
        }
      }
    });

    const [url] = await fileRef.getSignedUrl({
      action: 'read',
      expires: '03-01-2026'
    });

    res.json({
      success: true,
      url: url,
      fileName: file.originalname,
      fileSize: file.size,
      fileType: file.mimetype
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get documents for user
app.get('/api/documents/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const [files] = await bucket.getFiles({ prefix: userId + '/' });
    
    const documents = await Promise.all(files.map(async (file) => {
      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: '03-01-2026'
      });
      return {
        name: file.name.split('/').pop(),
        url: url,
        size: file.metadata.size,
        contentType: file.metadata.contentType,
        uploadedAt: file.metadata.metadata?.uploadedAt || file.metadata.timeCreated
      };
    }));
    
    res.json({ success: true, documents });
  } catch (error) {
    console.error('Error fetching documents:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on port ${process.env.PORT || 3000}`);
});
