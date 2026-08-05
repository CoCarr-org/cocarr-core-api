class CustomError extends Error {
    constructor(message, status = 500, errorCode = null) {
        super(message);
        this.name = message;
        this.status = status;
        this.errorCode = errorCode;
    }
}

// Error handling middleware
function errorHandlerMiddleware(err, req, res, next) {
    const status = err.status || 500;
    const errorCode = err.errorCode || 'INTERNAL_SERVER_ERROR';
    const message = err.message || 'An error occurred while processing your request.';
    res.status(status).json({ error: { code: errorCode, message } });
}

module.exports={errorHandlerMiddleware,CustomError}