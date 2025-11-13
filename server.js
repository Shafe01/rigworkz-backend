const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// MIDDLEWARE
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://rigworkz-app.web.app",
  "https://rigworkz-app.firebaseapp.com",
  "https://rigworkz.xyz",
  "https://www.rigworkz.xyz",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);

      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json());

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// MONGODB CONNECTION
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("ERROR: MONGODB_URI not found");
  process.exit(1);
}

mongoose
  .connect(MONGODB_URI)
  .then(() => {
    console.log("Connected to MongoDB");
    console.log(`Database: ${mongoose.connection.name}`);
  })
  .catch((error) => {
    console.error("MongoDB connection error:", error.message);
    process.exit(1);
  });

// Handle MongoDB connection events
mongoose.connection.on("disconnected", () => {
  console.log("MongoDB disconnected");
});

mongoose.connection.on("error", (err) => {
  console.error("MongoDB error:", err);
});

// MONGODB SCHEMA
const whitelistSchema = new mongoose.Schema(
  {
    address: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    registeredAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    ipAddress: {
      type: String,
      required: false,
    },
    userAgent: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: true,
  }
);

const Whitelist = mongoose.model("Whitelist", whitelistSchema);

function isValidEthereumAddress(address) {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

// API ENDPOINTS
app.post("/api/whitelist/register", async (req, res) => {
  try {
    const { address } = req.body;

    if (!address || typeof address !== "string") {
      return res.status(400).json({
        success: false,
        message: "Invalid wallet address",
      });
    }

    if (!isValidEthereumAddress(address)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Ethereum address format",
      });
    }

    const normalizedAddress = address.toLowerCase();

    const existing = await Whitelist.findOne({ address: normalizedAddress });
    if (existing) {
      console.log(`Duplicate registration attempt: ${normalizedAddress}`);
      return res.status(409).json({
        success: false,
        message: "Address already registered",
        registration: {
          address: existing.address,
          registeredAt: existing.registeredAt,
        },
      });
    }

    const registration = new Whitelist({
      address: normalizedAddress,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get("user-agent"),
    });

    await registration.save();

    console.log(`New registration: ${normalizedAddress}`);

    const totalCount = await Whitelist.countDocuments();
    console.log(`Total registrations: ${totalCount}`);

    res.status(201).json({
      success: true,
      message: "Successfully registered",
      address: registration.address,
      registeredAt: registration.registeredAt,
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

app.get("/api/whitelist/check/:address", async (req, res) => {
  try {
    const { address } = req.params;

    if (!address) {
      return res.status(400).json({
        success: false,
        message: "Address is required",
      });
    }

    if (!isValidEthereumAddress(address)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Ethereum address format",
      });
    }

    const normalizedAddress = address.toLowerCase();
    const registration = await Whitelist.findOne({
      address: normalizedAddress,
    });

    res.json({
      success: true,
      isRegistered: !!registration,
      registration: registration
        ? {
            address: registration.address,
            registeredAt: registration.registeredAt,
          }
        : null,
    });
  } catch (error) {
    console.error("Check registration error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

app.get("/api/whitelist/list", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const registrations = await Whitelist.find()
      .sort({ registeredAt: -1 })
      .skip(skip)
      .limit(limit)
      .select("address registeredAt");

    const totalCount = await Whitelist.countDocuments();

    res.json({
      success: true,
      count: registrations.length,
      total: totalCount,
      page,
      totalPages: Math.ceil(totalCount / limit),
      registrations,
    });
  } catch (error) {
    console.error("List registrations error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

app.get("/api/whitelist/stats", async (req, res) => {
  try {
    const total = await Whitelist.countDocuments();

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayCount = await Whitelist.countDocuments({
      registeredAt: { $gte: today },
    });

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekCount = await Whitelist.countDocuments({
      registeredAt: { $gte: weekAgo },
    });

    res.json({
      success: true,
      stats: {
        total,
        today: todayCount,
        lastWeek: weekCount,
      },
    });
  } catch (error) {
    console.error("Stats error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

app.delete("/api/whitelist/:address", async (req, res) => {
  try {
    const { address } = req.params;
    const normalizedAddress = address.toLowerCase();

    const result = await Whitelist.findOneAndDelete({
      address: normalizedAddress,
    });

    if (result) {
      console.log(`Address removed: ${normalizedAddress}`);
      res.json({
        success: true,
        message: "Address removed from whitelist",
      });
    } else {
      res.status(404).json({
        success: false,
        message: "Address not found",
      });
    }
  } catch (error) {
    console.error("Delete error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

app.get("/health", async (req, res) => {
  try {
    const dbStatus =
      mongoose.connection.readyState === 1 ? "connected" : "disconnected";
    const count = await Whitelist.countDocuments();

    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      database: dbStatus,
      registrations: count,
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      timestamp: new Date().toISOString(),
      error: error.message,
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Endpoint not found",
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    success: false,
    message: "Internal server error",
  });
});

// START SERVER
app.listen(PORT, () => {
  console.log(`\n RigWorkZ Whitelist API`);
  console.log(` Running on: http://localhost:${PORT}`);
  console.log(` Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`\n Endpoints:`);
  console.log(`   POST   /api/whitelist/register`);
  console.log(`   GET    /api/whitelist/check/:address`);
  console.log(`   GET    /api/whitelist/list`);
  console.log(`   GET    /api/whitelist/stats`);
  console.log(`   DELETE /api/whitelist/:address`);
  console.log(`   GET    /health`);
  console.log(`\n Ready to accept connections!\n`);
});

process.on("SIGTERM", async () => {
  console.log("\n SIGTERM received, closing server gracefully...");
  await mongoose.connection.close();
  console.log("MongoDB connection closed");
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("\n SIGINT received, closing server gracefully...");
  await mongoose.connection.close();
  console.log("MongoDB connection closed");
  process.exit(0);
});
