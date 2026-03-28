let userModel = require('../schemas/users')
let roleModel = require('../schemas/roles');
let mailHandler = require('../utils/mailHandler');
const ExcelJS = require('exceljs');
const crypto = require('crypto');
const path = require('path');

function generateRandomPassword(length = 16) {
    return crypto.randomBytes(length).toString('base64').slice(0, length).replace(/[/+=]/g, 'a');
}
module.exports = {
    CreateAnUser: async function (username, password, email, role, session,
        fullName, avatarUrl, status, loginCount) {
        let newItem = new userModel({
            username: username,
            password: password,
            email: email,
            fullName: fullName,
            avatarUrl: avatarUrl,
            status: status,
            role: role,
            loginCount: loginCount
        });
        await newItem.save({ session });
        return newItem;
    },
    GetAnUserByUsername: async function (username) {
        return await userModel.findOne({
            isDeleted: false,
            username: username
        })
    }, GetAnUserById: async function (id) {
        return await userModel.findOne({
            isDeleted: false,
            _id: id
        }).populate('role')
    }, GetAnUserByEmail: async function (email) {
        return await userModel.findOne({
            isDeleted: false,
            email: email
        })
    }, GetAnUserByToken: async function (token) {
        let user = await userModel.findOne({
            isDeleted: false,
            forgotPasswordToken: token
        })
        if (user.forgotPasswordTokenExp > Date.now()) {
            return user;
        }
        return false;
    },
    ImportUsersFromExcel: async function (fileSource) {
        // 1. Ensure 'user' role exists
        let userRole = await roleModel.findOne({ name: { $regex: /^user$/i } });
        if (!userRole) {
            userRole = new roleModel({
                name: 'user',
                description: 'Regular user role'
            });
            await userRole.save();
        }

        // 2. Read Excel File
        const workbook = new ExcelJS.Workbook();
        if (typeof fileSource === 'string') {
            await workbook.xlsx.readFile(fileSource);
        } else if (Buffer.isBuffer(fileSource)) {
            await workbook.xlsx.load(fileSource);
        } else {
             const defaultPath = path.join(__dirname, '../user.xlsx');
             await workbook.xlsx.readFile(defaultPath);
        }
        
        const worksheet = workbook.getWorksheet(1);

        const results = {
            success: [],
            skipped: [],
            errors: []
        };

        const usersToCreate = [];
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return; // Skip header

            const username = row.getCell(1).value;
            const emailValue = row.getCell(2).value;
            
            let email = emailValue;
            if (emailValue && typeof emailValue === 'object') {
                email = emailValue.result || emailValue.text;
            }

            if (username && email) {
                usersToCreate.push({ username, email });
            }
        });

        // 3. Create Users and Send Emails
        for (const userData of usersToCreate) {
            try {
                const existingUser = await userModel.findOne({
                    $or: [{ username: userData.username }, { email: userData.email }]
                });

                if (existingUser) {
                    results.skipped.push({ username: userData.username, reason: 'Already exists' });
                    continue;
                }

                const password = generateRandomPassword();
                const newUser = new userModel({
                    username: userData.username,
                    email: userData.email,
                    password: password,
                    role: userRole._id,
                    status: true
                });

                await newUser.save();
                await mailHandler.sendUserCredentials(userData.email, userData.username, password);
                results.success.push(userData.username);
            } catch (err) {
                results.errors.push({ username: userData.username, error: err.message });
            }
        }
        return results;
    }
}