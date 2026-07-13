import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const accessSecret = process.env.JWT_ACCESS_SECRET || "dev-access-secret";
const refreshSecret = process.env.JWT_REFRESH_SECRET || "dev-refresh-secret";

const hashPassword = async (password) => {
  return bcrypt.hash(password, 10);
};

const hashRefreshToken = async (refreshToken) => {
  return bcrypt.hash(refreshToken, 12);
};
const comparePassword = async (password, hashedPassword) => {
  return bcrypt.compare(password, hashedPassword);
};
const compareRefreshToken = async (refreshToken, hashedRefreshToken) => {
  return bcrypt.compare(refreshToken, hashedRefreshToken);
};

const generateAccessToken = (user) => {
  return jwt.sign(
    {
      id: user._id.toString(),
      email: user.email,
      userType: user.userType,
    },
    accessSecret,
    {
      expiresIn: "15m",
    },
  );
};

const generateRefreshToken = (user) => {
  return jwt.sign(
    {
      id: user._id.toString(),
      email: user.email,
      userType: user.userType,
    },
    refreshSecret,
    {
      expiresIn: "7d",
    },
  );
};

const generateTokenPair = (user) => {
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  return { accessToken, refreshToken };
};

const verifyAccessToken = (token) => {
  return jwt.verify(token, accessSecret);
};

const verifyRefreshToken = (token) => {
  return jwt.verify(token, refreshSecret);
};

export {
  hashPassword,
  comparePassword,
  generateAccessToken,
  generateRefreshToken,
  generateTokenPair,
  verifyAccessToken,
  verifyRefreshToken,
  hashRefreshToken,
  compareRefreshToken,
};
