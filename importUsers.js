const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const crypto = require('crypto');
const userModel = require('./schemas/users');
const roleModel = require('./schemas/roles');
const mailHandler = require('./utils/mailHandler');

// MongoDB Connection
const MONGO_URI = 'mongodb://localhost:27017/NNPTUD-C4';

function generateRandomPassword(length = 16) {
    return crypto.randomBytes(length).toString('base64').slice(0, length).replace(/[/+=]/g, 'a');
}

async function importUsers() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('Connected to MongoDB');

        // 1. Ensure 'user' role exists
        let userRole = await roleModel.findOne({ name: { $regex: /^user$/i } });
        if (!userRole) {
            console.log("Creating 'user' role...");
            userRole = new roleModel({
                name: 'user',
                description: 'Regular user role'
            });
            await userRole.save();
        }
        console.log(`Using Role: ${userRole.name} (${userRole._id})`);

        // 2. Read Excel File
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile('user.xlsx');
        const worksheet = workbook.getWorksheet(1);

        const usersToCreate = [];
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return; // Skip header

            const username = row.getCell(1).value;
            const email = (row.getCell(2).value && typeof row.getCell(2).value === 'object') 
                ? row.getCell(2).value.text 
                : row.getCell(2).value;

            if (username && email) {
                usersToCreate.push({ username, email });
            }
        });

        console.log(`Found ${usersToCreate.length} users to import.`);

        // 3. Create Users and Send Emails
        for (const userData of usersToCreate) {
            try {
                // Check if user already exists
                const existingUser = await userModel.findOne({ 
                    $or: [{ username: userData.username }, { email: userData.email }] 
                });

                if (existingUser) {
                    console.warn(`User ${userData.username} or ${userData.email} already exists. Skipping.`);
                    continue;
                }

                const password = generateRandomPassword();
                const newUser = new userModel({
                    username: userData.username,
                    email: userData.email,
                    password: password, // Schema pre-save will hash this
                    role: userRole._id,
                    status: true // Set active by default
                });

                await newUser.save();
                console.log(`Created user: ${userData.username}`);

                // Send Email
                await mailHandler.sendUserCredentials(userData.email, userData.username, password);
                
            } catch (err) {
                console.error(`Error creating user ${userData.username}:`, err.message);
            }
        }

        console.log('Import completed.');
    } catch (error) {
        console.error('Import failed:', error);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected from MongoDB');
    }
}

importUsers();
