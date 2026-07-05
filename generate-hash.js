// generate-hash.js
const bcrypt = require('bcryptjs');

const password = '@Motiva6060';

bcrypt.hash(password, 10, (err, hash) => {
    if (err) {
        console.error('Error generating hash:', err);
        return;
    }
    console.log('🔑 Password:', password);
    console.log('🔐 Hash:', hash);
    console.log('\n📋 Copy this hash and update your admin document in MongoDB:');
    console.log(hash);
});
