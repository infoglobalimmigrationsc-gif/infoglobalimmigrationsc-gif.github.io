const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');

async function createAdmin() {
    const uri = "mongodb://giscadmin:GISCsecure2024!@ac-lfqluos-shard-00-00.rkaqbht.mongodb.net:27017,ac-lfqluos-shard-00-01.rkaqbht.mongodb.net:27017,ac-lfqluos-shard-00-02.rkaqbht.mongodb.net:27017/gisc-app?ssl=true&replicaSet=atlas-r7gnc7-shard-0&authSource=admin&retryWrites=true&w=majority&appName=GISCAPP0";
    
    const client = new MongoClient(uri);
    
    try {
        await client.connect();
        const db = client.db('gisc-app');
        
        const hashedPassword = await bcrypt.hash('@Motiva6060', 10);
        
        const admin = {
            name: 'Super Admin',
            email: 'admin@globalimmigrationsc.com',
            password: hashedPassword,
            role: 'super_admin',
            createdAt: new Date(),
            updatedAt: new Date()
        };
        
        const existing = await db.collection('admins').findOne({ email: admin.email });
        if (existing) {
            await db.collection('admins').updateOne(
                { email: admin.email },
                { $set: { password: hashedPassword, updatedAt: new Date() } }
            );
            console.log('✅ Admin password updated');
        } else {
            await db.collection('admins').insertOne(admin);
            console.log('✅ Admin created');
        }
        
        console.log('📧 Email: admin@globalimmigrationsc.com');
        console.log('🔑 Password: @Motiva6060');
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.close();
    }
}

createAdmin();
