// create-admin.js
const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');

async function createAdmin() {
    const uri = "mongodb://giscadmin:GISCsecure2024!@ac-lfqluos-shard-00-00.rkaqbht.mongodb.net:27017,ac-lfqluos-shard-00-01.rkaqbht.mongodb.net:27017,ac-lfqluos-shard-00-02.rkaqbht.mongodb.net:27017/gisc-app?ssl=true&replicaSet=atlas-r7gnc7-shard-0&authSource=admin&retryWrites=true&w=majority&appName=GISCAPP0";
    
    const client = new MongoClient(uri);
    
    try {
        await client.connect();
        console.log('✅ Connected to MongoDB');
        
        const db = client.db('gisc-app');
        
        // Hash the password: @Motiva6060
        const hashedPassword = await bcrypt.hash('@Motiva6060', 10);
        console.log('✅ Password hashed');
        
        const admin = {
            name: 'Super Admin',
            email: 'admin@globalimmigrationsc.com',
            password: hashedPassword,
            role: 'super_admin',
            createdAt: new Date(),
            updatedAt: new Date()
        };
        
        // Check if admin already exists
        const existing = await db.collection('admins').findOne({ email: admin.email });
        if (existing) {
            console.log('🔄 Admin exists, updating password...');
            await db.collection('admins').updateOne(
                { email: admin.email },
                { $set: { password: hashedPassword, updatedAt: new Date() } }
            );
            console.log('✅ Admin password updated');
        } else {
            await db.collection('admins').insertOne(admin);
            console.log('✅ Admin user created successfully!');
        }
        
        console.log('\n📧 Email: admin@globalimmigrationsc.com');
        console.log('🔑 Password: @Motiva6060');
        console.log('📁 Database: gisc-app');
        console.log('📁 Collection: admins');
        
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await client.close();
        console.log('✅ Connection closed');
    }
}

// Run the function
createAdmin();
