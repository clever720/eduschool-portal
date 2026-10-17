function requireAuth(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Please sign in to continue.' });
  next();
}
function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.session?.user) return res.status(401).json({ error: 'Please sign in to continue.' });
    if (!roles.includes(req.session.user.role)) return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    next();
  };
}
module.exports = { requireAuth, allowRoles };
