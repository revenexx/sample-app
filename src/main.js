module.exports = async (context) => {
    const { req, res, log } = context;

    log(`sample-app ${process.env.REVENEXX_APP_NAME ?? 'unknown'} hit by ${req.method} ${req.path}`);

    const name = req.query?.name ?? req.body?.name ?? 'world';

    return res.json({
        message: `Hello, ${name}!`,
        app: {
            id: process.env.REVENEXX_APP_ID ?? null,
            name: process.env.REVENEXX_APP_NAME ?? null,
            deployment: process.env.REVENEXX_APP_DEPLOYMENT ?? null,
            runtime: `${process.env.REVENEXX_APP_RUNTIME_NAME ?? ''}-${process.env.REVENEXX_APP_RUNTIME_VERSION ?? ''}`,
        },
        timestamp: new Date().toISOString(),
    });
};
