# MicroEarn Server

RESTful API server for the MicroEarn micro-task platform.

## 🌐 Live API

**API URL:** [https://microearn-server.vercel.app](https://microearn-server.vercel.app)

## 🔐 Admin Credentials

- **Email:** admin@microearn.com
- **Password:** admin123456

## ✨ Features

1. **RESTful API Design** - Clean, consistent API endpoints following REST conventions

2. **JWT Authentication** - Secure token-based authentication with configurable expiration

3. **Role-Based Access Control** - Middleware-based permission system for Worker, Buyer, and Admin roles

4. **User Management** - Registration, login, profile updates, and admin user management

5. **Task System** - Create, read, update, delete tasks with automatic coin deduction

6. **Submission Workflow** - Submit work, review submissions, automatic coin transfers on approval

7. **Withdrawal Processing** - Request withdrawals, admin approval/rejection with refund handling

8. **Report System** - Create and manage reports for platform moderation

9. **MongoDB Integration** - Mongoose ODM with proper schema validation and indexing

10. **Error Handling** - Consistent error responses with meaningful messages

11. **CORS Configuration** - Configurable cross-origin resource sharing

12. **Password Security** - bcrypt hashing with salt rounds for secure password storage

## 🛠️ Tech Stack

- **Runtime:** Node.js
- **Framework:** Express.js
- **Database:** MongoDB with Mongoose
- **Authentication:** JWT (jsonwebtoken)
- **Security:** bcryptjs, CORS
- **Environment:** dotenv

## 📦 Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/microearn-server.git

# Navigate to project directory
cd microearn-server

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env

# Run development server
npm run dev
```

## 🔧 Environment Variables

```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/microearn
JWT_SECRET=your-jwt-secret-key
JWT_EXPIRES_IN=7d
CLIENT_URL=http://localhost:3000
```

## 📡 API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login user |
| POST | `/api/auth/google` | Google OAuth login |
| GET | `/api/auth/me` | Get current user |

### Users
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users` | Get all users (Admin) |
| GET | `/api/users/top-workers` | Get top workers |
| GET | `/api/users/:id` | Get user by ID |
| PATCH | `/api/users/profile` | Update profile |
| PATCH | `/api/users/:id/role` | Update user role (Admin) |
| DELETE | `/api/users/:id` | Delete user (Admin) |

### Tasks
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tasks` | Get all tasks |
| GET | `/api/tasks/:id` | Get task by ID |
| POST | `/api/tasks` | Create task (Buyer) |
| PATCH | `/api/tasks/:id` | Update task |
| DELETE | `/api/tasks/:id` | Delete task |

### Submissions
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/submissions` | Get submissions |
| POST | `/api/submissions` | Create submission (Worker) |
| PATCH | `/api/submissions/:id/review` | Review submission (Buyer) |

### Withdrawals
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/withdrawals` | Get withdrawals |
| POST | `/api/withdrawals` | Request withdrawal |
| PATCH | `/api/withdrawals/:id` | Process withdrawal (Admin) |

### Reports
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/reports` | Get reports |
| POST | `/api/reports` | Create report |
| PATCH | `/api/reports/:id` | Update report (Admin) |

## 📁 Project Structure

```
src/
├── config/
│   └── db.js              # MongoDB connection
├── middleware/
│   └── auth.js            # JWT authentication
├── models/
│   ├── User.js            # User schema
│   ├── Task.js            # Task schema
│   ├── Submission.js      # Submission schema
│   ├── Withdrawal.js      # Withdrawal schema
│   └── Report.js          # Report schema
├── routes/
│   ├── auth.js            # Auth routes
│   ├── users.js           # User routes
│   ├── tasks.js           # Task routes
│   ├── submissions.js     # Submission routes
│   ├── withdrawals.js     # Withdrawal routes
│   └── reports.js         # Report routes
└── index.js               # Server entry point
```

## 🚀 Deployment

The API is deployed on Vercel/Railway. Push to the main branch to trigger automatic deployment.

## 📄 License

MIT License