import { Controller, Get, Inject, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { classifierHealth } from '@tasnivo/domain/classifier-health';
import { classifierState, type ClassifierState } from '@tasnivo/domain/classifier-state';
import { PrismaService } from '../db/prisma.service';

/**
 * 200 when the API can serve audits: database reachable and the classifier loaded; 503 otherwise.
 * The web app's /api/health is this route (its /api rewrite reaches the API): booleans,
 * the classifier copy's age and how its last update ended, nothing about customers or keys.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Database and classifier status (for load balancers and uptime checks).' })
  @ApiResponse({ status: 200, description: 'Ready.' })
  @ApiResponse({ status: 503, description: 'Database unreachable or classifier not loaded.' })
  async health(@Res({ passthrough: true }) res: Response) {
    let database = false;
    let loaded = false;
    let state: ClassifierState | null = null;
    try {
      const rows = await this.prisma.client.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok FROM mxik_code WHERE "retiredAt" IS NULL LIMIT 1`;
      database = true;
      loaded = rows.length > 0;
      state = await classifierState();
    } catch {
      // Unreachable database, or migrations not applied yet.
    }
    const ok = database && loaded;
    res.status(ok ? 200 : 503);
    return { status: ok ? 'ok' : 'unavailable', database, classifier: classifierHealth(loaded, state) };
  }
}
