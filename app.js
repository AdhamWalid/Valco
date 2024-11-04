const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const chalk = require('chalk');
const { profile } = require('console');
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = process.env.PORT || 3030;
const log = console.log;
const Sentiment = require('sentiment');
const sentiment = new Sentiment();



// Connect to MongoDB
mongoose.connect('mongodb+srv://Adham:f6BFkacaENuEeoDY@hospital.94gew.mongodb.net/valo_auth')
    .then(() => log(chalk`{green [Success]} Connected to MongoDB`))
    .catch(err => log(chalk`{red [Error]} ${err.message}`));

// Define Models
const userSchema = new mongoose.Schema({
    full_name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    profileurl: { type: String, default: "uploads/default.JPG" },
    badges : {type:Object , default: {admin:false , bug_hunter:false , active:false , owner:false}},
    admin: { type: Boolean, default: false }
});

const User = mongoose.model('User', userSchema);

const messageSchema = new mongoose.Schema({
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Users' },
    message: { type: String, required: true , default: " "},
    timestamp: { type: Date, default: Date.now },
    room: { type: String, required: false }  // Make room optional if not required
});


const Message = mongoose.model('Message', messageSchema);

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'views')));
app.use(session({
    secret: 'VERYSECRETKEY',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Multer for profile picture upload
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage: storage });

// Helper: Check Admin Middleware
function isAdmin(req, res, next) {
    if (req.session.userId && req.session.isAdmin) next();
    else res.status(403).json({ error: 'Forbidden' });
}

// Routes
app.get('/', (req, res) => res.redirect('/home'));

app.get('/home', (req, res) => res.render('index',  {
    status : req.session.userId
}));

// app.get('/test', (req, res) => res.render('loghome',  {
//     status : req.session.userId
// }));
// User Signup
app.post('/signup', async (req, res) => {
    const { full_name, email, password } = req.body;
    try {
        if (await User.findOne({ email })) return res.status(400).json({ error: 'Email exists' });
        const hashedPassword = await bcrypt.hash(password, 10);
        await new User({ full_name, email, password: hashedPassword }).save();
        res.status(201).json({ message: 'Registered successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// User Login
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
  

        const user = await User.findOne({ email });
        if (!user || !await bcrypt.compare(password, user.password)) {
            return res.status(400).json({ error: 'Invalid login' });
        }
        req.session.userId = user._id;
        req.session.fullName = user.full_name;
        req.session.isAdmin = user.admin;
        req.session.profilepic = user.profileurl;
        
        // Send JSON response with a flag indicating success
        res.status(200).json({ message: 'Login successful', redirect: '/' });
        
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});


// Lopgout
app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('Error during logout:', err);
            return res.status(500).json({ error: 'Could not log out' });
        }
        res.redirect('/home');
    });
});
 

// Chat Room
app.get('/chat', async (req, res) => {
    if (!req.session.userId) return res.redirect('/home');

    // 
    
    console.log(req.session)
    res.render('chat', { username: `${req.session.fullName}`,
                         isAdmin: req.session.isAdmin , 
                         senderId:req.session.userId ,
                         profilePicture: req.session.profilepic,
            });
});



// Profile
app.get('/profile', async (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/home');
    }

    try {
        const user = await User.findById(req.session.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        // Fallback to a default profile picture if profileurl is not set
        res.render('profile', {
            fullName: user.full_name,
            email: user.email,
            profilePicture: user.profileurl || '/uploads/default-profile.png',
            admin : user.admin,
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
        console.error(error);
    }
});


// Edit Profile
app.get('/edit-profile', async (req, res) => {
    if (!req.session.userId) return res.redirect('/home');
    const user = await User.findById(req.session.userId);
    res.render('edit-profile', 
        {
            admin: user.admin,
            full_name: user.full_name,
            email: user.email,
            profilePicture: user.profileurl,
            __v: 0
          }
    );
});

app.post('/update-profile', upload.single('profilePicture'), async (req, res) => {
    const updateData = { full_name: req.body.fullName, email: req.body.email };
    if (req.file) updateData.profileurl = `/uploads/${req.file.filename}`;
    let = req.session.profileurl = updateData.profileurl;
    if (req.body.password) updateData.password = await bcrypt.hash(req.body.password, 10);
    await User.findByIdAndUpdate(req.session.userId, updateData);
    res.redirect('/profile');
});

app.post('/send-message', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const { message, room = "default" } = req.body;
    const senderId = req.session.userId;
    const sentimentScore = sentiment.analyze(message).score;


    if (!message) {
        return res.status(400).json({ error: 'Message content is required' });
    }

    try {
        const newMessage = new Message({
            senderId: mongoose.Types.ObjectId(senderId),  // Ensure ObjectId type
            message,
            room
        });
        await newMessage.save();

        res.status(201).json({ message: 'Message sent successfully' });
    } catch (error) {
        console.error('Error saving message:', error);
        res.status(500).json({ error: 'Server error' });
    }
});



// Delete Message (Admin only)
// app.delete('/delete-message/:id', isAdmin, async (req, res) => {
//     try {
//         await Message.findByIdAndDelete(req.params.id);
//         io.emit('delete message', req.params.id); // Notify clients about the deletion
//         res.status(200).json({ message: 'Message deleted' });
//     } catch (error) {
//         res.status(500).json({ error: 'Server error' });
//     }
// });



// 404 Page

app.use((req, res) => res.status(404).render('404'));

// Socket.io Chat Integration
io.on('connection', (socket) => {

    const chatbotResponses = {
        '/help': 'Here are some commands you can try: /help, /tips',
        '/tips': 'Remember to be respectful and have fun!',
    };


    
    socket.on('chat message', async (msgData) => {
        if (chatbotResponses[msgData.message]) {
            socket.emit('chat message', { message: chatbotResponses[msgData.message], senderId: 'Chatbot' });
        }else {
        const newMessage = await new Message(msgData).save();
        io.emit('chat message', { ...msgData, id: newMessage._id });
    }});
});


// Start Server
server.listen(port, () => log(chalk`{green [Success]} Listening on port {green ${port}}`));
