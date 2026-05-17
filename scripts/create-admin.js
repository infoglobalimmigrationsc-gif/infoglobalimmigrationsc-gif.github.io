// scripts/create-admin.js
const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');

async function createAdmin() {
    const uri = process.env.MONGODB_URI;
    const client = new MongoClient(uri);
    
    try {
        await client.connect();
        const db = client.db('gisc-app');
        
        const hashedPassword = await bcrypt.hash('Admin@2024!', 10);
        
        const admin = {
            name: 'Super Admin',
            email: 'admin@globalimmigrationsc.com',
            password: hashedPassword,
            role: 'super_admin',
            createdAt: new Date()
        };
        
        await db.collection('admins').insertOne(admin);
        console.log('Admin user created successfully!');
        console.log('Email: admin@globalimmigrationsc.com');
        console.log('Password: Admin@2024!');
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.close();
    }
}

createAdmin();
