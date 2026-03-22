import { z } from 'zod'
import type { Tool, ToolResult, UserContext } from '@/lib/llm/types'

// Determine which health provider the user has connected
function getHealthProvider(ctx: UserContext): 'oura' | 'whoop' | null {
  if (ctx.tokens.oura) return 'oura'
  if (ctx.tokens.whoop) return 'whoop'
  return null
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0]
}

function yesterdayStr(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

async function fetchOura(path: string, ctx: UserContext, params?: Record<string, string>): Promise<unknown> {
  const { ouraFetch } = await import('@/lib/integrations/oura')
  return ouraFetch(path, ctx.tokens.oura!, ctx.userId, params)
}

async function fetchWhoop(path: string, ctx: UserContext, params?: Record<string, string>): Promise<unknown> {
  const { whoopFetch } = await import('@/lib/integrations/whoop')
  return whoopFetch(path, ctx.tokens.whoop!, ctx.userId, params)
}

// --- health_sleep ---

const SleepInput = z.object({
  date: z.string().optional().describe('Date in YYYY-MM-DD format (default: last night)'),
})

export const healthSleep: Tool = {
  name: 'health_sleep',
  description: 'Get sleep data including duration, stages, efficiency, HRV, and temperature. Works with Oura Ring or WHOOP.',
  inputSchema: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'Date in YYYY-MM-DD format (default: last night)' },
    },
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    const provider = getHealthProvider(ctx)
    if (!provider) {
      return { success: false, error: 'No health device connected. Connect Oura or WHOOP in The Harbor settings.' }
    }

    try {
      const parsed = SleepInput.parse(input)
      const date = parsed.date ?? yesterdayStr()

      if (provider === 'oura') {
        const data = await fetchOura('/usercollection/daily_sleep', ctx, {
          start_date: date,
          end_date: date,
        }) as { data: Array<Record<string, unknown>> }

        const sleep = data.data?.[0]
        if (!sleep) return { success: true, data: { message: `No sleep data for ${date}`, date } }

        return {
          success: true,
          data: {
            provider: 'oura',
            date,
            score: sleep.score,
            totalSleepDuration: sleep.contributors ? undefined : null,
            deepSleep: (sleep.contributors as Record<string, unknown>)?.deep_sleep,
            remSleep: (sleep.contributors as Record<string, unknown>)?.rem_sleep,
            efficiency: (sleep.contributors as Record<string, unknown>)?.efficiency,
            restfulness: (sleep.contributors as Record<string, unknown>)?.restfulness,
            latency: (sleep.contributors as Record<string, unknown>)?.latency,
            raw: sleep,
          },
        }
      }

      // WHOOP
      const data = await fetchWhoop('/activity/sleep', ctx, {
        start: `${date}T00:00:00.000Z`,
        end: `${date}T23:59:59.999Z`,
      }) as { records: Array<Record<string, unknown>> }

      const sleep = data.records?.[0]
      if (!sleep) return { success: true, data: { message: `No sleep data for ${date}`, date } }

      const score = sleep.score as Record<string, unknown> | undefined

      return {
        success: true,
        data: {
          provider: 'whoop',
          date,
          qualityDuration: score?.quality_duration_ms,
          totalInBedDuration: score?.total_in_bed_time_milli,
          remDuration: score?.rem_sleep_time_milli,
          slowWaveDuration: score?.sws_sleep_time_milli,
          lightDuration: score?.light_sleep_time_milli,
          wakeDuration: score?.wake_time_milli,
          sleepEfficiency: score?.sleep_efficiency_percentage,
          respiratoryRate: score?.respiratory_rate,
          raw: sleep,
        },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: `Failed to fetch sleep data: ${msg}` }
    }
  },
}

// --- health_readiness ---

export const healthReadiness: Tool = {
  name: 'health_readiness',
  description: 'Get readiness score (Oura) or recovery score (WHOOP). Indicates how prepared your body is for the day.',
  inputSchema: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'Date in YYYY-MM-DD format (default: today)' },
    },
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    const provider = getHealthProvider(ctx)
    if (!provider) {
      return { success: false, error: 'No health device connected. Connect Oura or WHOOP in The Harbor settings.' }
    }

    try {
      const parsed = SleepInput.parse(input)
      const date = parsed.date ?? todayStr()

      if (provider === 'oura') {
        const data = await fetchOura('/usercollection/daily_readiness', ctx, {
          start_date: date,
          end_date: date,
        }) as { data: Array<Record<string, unknown>> }

        const readiness = data.data?.[0]
        if (!readiness) return { success: true, data: { message: `No readiness data for ${date}`, date } }

        return {
          success: true,
          data: {
            provider: 'oura',
            date,
            score: readiness.score,
            temperatureDeviation: readiness.temperature_deviation,
            temperatureTrend: readiness.temperature_trend_deviation,
            contributors: readiness.contributors,
          },
        }
      }

      // WHOOP recovery
      const data = await fetchWhoop('/recovery', ctx, {
        start: `${date}T00:00:00.000Z`,
        end: `${date}T23:59:59.999Z`,
      }) as { records: Array<Record<string, unknown>> }

      const recovery = data.records?.[0]
      if (!recovery) return { success: true, data: { message: `No recovery data for ${date}`, date } }

      const score = recovery.score as Record<string, unknown> | undefined

      return {
        success: true,
        data: {
          provider: 'whoop',
          date,
          recoveryScore: score?.recovery_score,
          restingHeartRate: score?.resting_heart_rate,
          hrv: score?.hrv_rmssd_milli,
          spo2: score?.spo2_percentage,
          skinTemp: score?.skin_temp_celsius,
        },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: `Failed to fetch readiness data: ${msg}` }
    }
  },
}

// --- health_activity ---

export const healthActivity: Tool = {
  name: 'health_activity',
  description: 'Get daily activity data — steps, calories, active time (Oura) or strain score and calories (WHOOP).',
  inputSchema: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'Date in YYYY-MM-DD format (default: today)' },
    },
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    const provider = getHealthProvider(ctx)
    if (!provider) {
      return { success: false, error: 'No health device connected. Connect Oura or WHOOP in The Harbor settings.' }
    }

    try {
      const parsed = SleepInput.parse(input)
      const date = parsed.date ?? todayStr()

      if (provider === 'oura') {
        const data = await fetchOura('/usercollection/daily_activity', ctx, {
          start_date: date,
          end_date: date,
        }) as { data: Array<Record<string, unknown>> }

        const activity = data.data?.[0]
        if (!activity) return { success: true, data: { message: `No activity data for ${date}`, date } }

        return {
          success: true,
          data: {
            provider: 'oura',
            date,
            score: activity.score,
            steps: activity.steps,
            activeCalories: activity.active_calories,
            totalCalories: activity.total_calories,
            targetCalories: activity.target_calories,
            sedentaryTime: activity.sedentary_time,
            restingTime: activity.resting_time,
            highActivityTime: activity.high_activity_time,
            mediumActivityTime: activity.medium_activity_time,
            lowActivityTime: activity.low_activity_time,
          },
        }
      }

      // WHOOP cycle/strain
      const data = await fetchWhoop('/cycle', ctx, {
        start: `${date}T00:00:00.000Z`,
        end: `${date}T23:59:59.999Z`,
      }) as { records: Array<Record<string, unknown>> }

      const cycle = data.records?.[0]
      if (!cycle) return { success: true, data: { message: `No activity data for ${date}`, date } }

      const score = cycle.score as Record<string, unknown> | undefined

      return {
        success: true,
        data: {
          provider: 'whoop',
          date,
          strain: score?.strain,
          kilojoules: score?.kilojoule,
          averageHeartRate: score?.average_heart_rate,
          maxHeartRate: score?.max_heart_rate,
        },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: `Failed to fetch activity data: ${msg}` }
    }
  },
}

// --- health_heart_rate ---

export const healthHeartRate: Tool = {
  name: 'health_heart_rate',
  description: 'Get heart rate data including resting heart rate and HRV (heart rate variability).',
  inputSchema: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'Date in YYYY-MM-DD format (default: today)' },
    },
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    const provider = getHealthProvider(ctx)
    if (!provider) {
      return { success: false, error: 'No health device connected. Connect Oura or WHOOP in The Harbor settings.' }
    }

    try {
      const parsed = SleepInput.parse(input)
      const date = parsed.date ?? todayStr()

      if (provider === 'oura') {
        const data = await fetchOura('/usercollection/heartrate', ctx, {
          start_date: date,
          end_date: date,
        }) as { data: Array<Record<string, unknown>> }

        const samples = data.data ?? []
        if (samples.length === 0) return { success: true, data: { message: `No heart rate data for ${date}`, date } }

        // Calculate stats from samples
        const bpms = samples.map((s) => s.bpm as number).filter(Boolean)
        const resting = Math.min(...bpms)
        const avg = Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length)
        const max = Math.max(...bpms)

        return {
          success: true,
          data: {
            provider: 'oura',
            date,
            restingHeartRate: resting,
            averageHeartRate: avg,
            maxHeartRate: max,
            sampleCount: samples.length,
          },
        }
      }

      // WHOOP — recovery endpoint includes resting HR and HRV
      const data = await fetchWhoop('/recovery', ctx, {
        start: `${date}T00:00:00.000Z`,
        end: `${date}T23:59:59.999Z`,
      }) as { records: Array<Record<string, unknown>> }

      const recovery = data.records?.[0]
      if (!recovery) return { success: true, data: { message: `No heart rate data for ${date}`, date } }

      const score = recovery.score as Record<string, unknown> | undefined

      return {
        success: true,
        data: {
          provider: 'whoop',
          date,
          restingHeartRate: score?.resting_heart_rate,
          hrvRmssd: score?.hrv_rmssd_milli,
          spo2: score?.spo2_percentage,
        },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: `Failed to fetch heart rate data: ${msg}` }
    }
  },
}

// --- health_summary ---

export const healthSummary: Tool = {
  name: 'health_summary',
  description: 'Get a combined daily health snapshot — sleep, readiness/recovery, and activity in one call. Great for morning briefings.',
  inputSchema: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'Date in YYYY-MM-DD format (default: today)' },
    },
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    const provider = getHealthProvider(ctx)
    if (!provider) {
      return { success: false, error: 'No health device connected. Connect Oura or WHOOP in The Harbor settings.' }
    }

    try {
      const parsed = SleepInput.parse(input)
      const date = parsed.date ?? todayStr()
      const sleepDate = parsed.date ?? yesterdayStr()

      // Fetch all three in parallel
      const [sleepResult, readinessResult, activityResult] = await Promise.allSettled([
        healthSleep.execute({ date: sleepDate }, ctx),
        healthReadiness.execute({ date }, ctx),
        healthActivity.execute({ date }, ctx),
      ])

      return {
        success: true,
        data: {
          provider,
          date,
          sleep: sleepResult.status === 'fulfilled' ? (sleepResult.value as ToolResult).data : null,
          readiness: readinessResult.status === 'fulfilled' ? (readinessResult.value as ToolResult).data : null,
          activity: activityResult.status === 'fulfilled' ? (activityResult.value as ToolResult).data : null,
        },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: `Failed to fetch health summary: ${msg}` }
    }
  },
}
