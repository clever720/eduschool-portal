function validate(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Please check the submitted information.', details: parsed.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) });
    }
    req.validatedBody = parsed.data;
    next();
  };
}
module.exports = { validate };
