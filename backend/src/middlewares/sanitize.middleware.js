/**
 * Input Sanitization Middleware
 * Prevents NoSQL injection and XSS attacks
 */

const sanitizeString = (str) => {
  if (typeof str !== "string") return str;
  return str
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/[${}[\]()]/g, "")
    .trim();
};

const sanitizeObject = (obj) => {
  if (Array.isArray(obj)) return obj.map(sanitizeObject);
  if (obj && typeof obj === "object") {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeObject(value);
    }
    return sanitized;
  }
  return sanitizeString(obj);
};

export const sanitizeInput = (req, res, next) => {
  if (req.body && typeof req.body === "object") {
    req.body = sanitizeObject(req.body);
  }
  if (req.query && typeof req.query === "object") {
    req.query = sanitizeObject(req.query);
  }
  if (req.params && typeof req.params === "object") {
    req.params = sanitizeObject(req.params);
  }
  next();
};

export default sanitizeInput;
