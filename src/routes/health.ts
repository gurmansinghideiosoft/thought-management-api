import { Router } from 'express';

const router = Router();

interface HealthResponse {
  status: 'ok';
  uptime: number;
  timestamp: string;
}

/**
 * GET /health
 *
 * Liveness probe for load balancers, uptime monitors, and orchestrators. Keep
 * it cheap and dependency-free — it must not touch the database or any external
 * service.
 */
router.get('/', (_req, res) => {
  const body: HealthResponse = {
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  };

  res.json(body);
});

export default router;
