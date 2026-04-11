import SunCalc from 'suncalc';
import {
  Coordinates,
  WeatherConditions,
  SunsetScore,
  ScoringFactors,
  FactorScore,
  CloudType,
} from '../models/types';

/**
 * Sunset Scoring Service
 * 
 * Calculates sunset quality scores based on atmospheric conditions.
 * 
 * Research-backed scoring methodology (0-100):
 * Key principle: Great sunsets = sunlight through atmosphere + particles + cloud reflection
 * 
 * Weights based on atmospheric physics (Rayleigh + Mie scattering):
 * - Cloud Structure (40%): Type, coverage, altitude - THE primary driver
 *   - Optimal: 25-60% coverage with mid/high-altitude clouds
 *   - Clouds act as projection screens for colors
 * 
 * - Atmospheric Clarity (25%): Aerosols + visibility balance
 *   - Moderate particles = best (enhance reds/oranges via Mie scattering)
 *   - Too clean = boring, too polluted = muted
 * 
 * - Humidity (12%): Moisture creates color blending
 *   - Medium humidity optimal, too high = haze
 * 
 * - Weather Dynamics (13%): Post-storm clearing = magic trigger
 *   - Recent rain removes large particles, leaves structured clouds
 * 
 * - Sun Geometry (10%): Seasonal angle, latitude effects
 *   - Baseline modifier, longer atmospheric path = more scattering
 */

class ScoringService {
  // Research-backed scoring weights (sum to 1.0)
  private readonly WEIGHTS = {
    cloudStructure: 0.40,      // Combined coverage + type + altitude
    atmosphericClarity: 0.25,  // Combined visibility + aerosols
    humidity: 0.12,
    weatherDynamics: 0.13,
    sunGeometry: 0.10,
  };

  /**
   * Calculate sunset score for given weather conditions
   */
  calculateScore(
    conditions: WeatherConditions,
    coords: Coordinates,
    date: Date,
    previousConditions?: WeatherConditions,
    recentPrecipitation = previousConditions?.precipitation ?? 0
  ): SunsetScore {
    const sunsetTime = SunCalc.getTimes(date, coords.lat, coords.lng).sunset;

    // Calculate individual factor scores using research-backed methods
    const cloudStructureScore = this.scoreCloudStructure(
      conditions.cloudCover,
      conditions.cloudTypes || [],
      conditions.cloudCoverLow,
      conditions.cloudCoverMid,
      conditions.cloudCoverHigh
    );
    const atmosphericClarityScore = this.scoreAtmosphericClarity(
      conditions.visibility,
      conditions.aqi,
      conditions.humidity,
      conditions.vaporPressureDeficit,
      conditions.weatherCode,
      conditions.precipitation ?? 0
    );
    const humidityScore = this.scoreHumidity(conditions.humidity);
    const pressureTrendScore = this.scorePressureTrend(
      conditions.pressure,
      previousConditions
    );
    const weatherDynamicsScore = this.scoreWeatherDynamics(
      conditions.weatherCode,
      conditions.precipitation ?? 0,
      conditions.pressure,
      previousConditions,
      recentPrecipitation
    );
    const sunGeometryScore = this.scoreSunGeometry(
      coords.lat,
      date
    );

    // Calculate weighted total score
    const totalScore =
      cloudStructureScore.score * this.WEIGHTS.cloudStructure +
      atmosphericClarityScore.score * this.WEIGHTS.atmosphericClarity +
      humidityScore.score * this.WEIGHTS.humidity +
      weatherDynamicsScore.score * this.WEIGHTS.weatherDynamics +
      sunGeometryScore.score * this.WEIGHTS.sunGeometry;

    // Calculate confidence based on data completeness
    const confidence = this.calculateConfidence(conditions, previousConditions);

    // Build factors object for API response (backward compatible)
    const factors: ScoringFactors = {
      cloudCoverage: cloudStructureScore, // Keep old name for API compatibility
      cloudType: { value: 0, score: cloudStructureScore.score, weight: 0, impact: cloudStructureScore.impact },
      atmosphericClarity: atmosphericClarityScore,
      aerosols: { value: 0, score: atmosphericClarityScore.score, weight: 0, impact: atmosphericClarityScore.impact },
      humidity: humidityScore,
      pressureTrend: pressureTrendScore,
      weatherDynamics: weatherDynamicsScore,
    };

    return {
      score: Math.round(totalScore),
      date,
      sunsetTime,
      confidence,
      factors,
    };
  }

  /**
   * Score cloud structure - THE most important factor (40%)
   * Combines coverage, type, and altitude into one comprehensive score
   * 
   * Optimal: 25-60% coverage with mid/high-altitude clouds
   * Clouds act as projection screens catching sunlight from below
   */
  private scoreCloudStructure(
    cloudCover: number,
    cloudTypes: CloudType[],
    cloudLow = 0,
    cloudMid = 0,
    cloudHigh = 0
  ): FactorScore {
    let coverageScore: number;
    let typeBonus = 0;
    let layerScore = 0;

    // COVERAGE SCORING (based on 25-60% optimal range)
    if (cloudCover < 10) {
      // Too clear - boring gradient, no drama
      coverageScore = 35;
    } else if (cloudCover >= 10 && cloudCover < 25) {
      // Light clouds - some enhancement
      coverageScore = 50 + (cloudCover - 10) * 2; // 50-80
    } else if (cloudCover >= 25 && cloudCover <= 60) {
      // OPTIMAL RANGE - dramatic sunsets
      coverageScore = 100;
    } else if (cloudCover > 60 && cloudCover <= 80) {
      // Heavy but not blocking
      coverageScore = 100 - (cloudCover - 60) * 1.5; // 100-70
    } else {
      // Overcast - sun likely blocked unless upper layers dominate
      coverageScore = Math.max(10, 70 - (cloudCover - 80) * 2.5);
    }

    // ALTITUDE / LAYER SCORING
    // High and mid clouds are valuable because they catch low-angle light.
    layerScore += Math.min(18, cloudHigh * 0.3);
    layerScore += Math.min(20, cloudMid * 0.35);

    // Low clouds often block the light path rather than reflecting it.
    if (cloudLow >= 70) {
      layerScore -= 22;
    } else if (cloudLow >= 45) {
      layerScore -= 12;
    } else if (cloudLow >= 20) {
      layerScore -= 5;
    }

    // Layered mid/high structure tends to create the most cinematic sunsets.
    if (cloudMid >= 25 && cloudHigh >= 15 && cloudLow < 60) {
      layerScore += 8;
    }

    // Low-cloud dominance is usually a bad sign even when total coverage is "optimal".
    if (cloudLow > (cloudMid + cloudHigh) && cloudLow > 55) {
      layerScore -= 10;
    }

    // TYPE BONUS (cloud altitude and structure)
    // Keep type influence modest because altitude layers are now scored explicitly.
    if (cloudTypes.length > 0 && !cloudTypes.includes('clear')) {
      const typeScores: Record<CloudType, number> = {
        clear: 0,
        cirrus: 8,
        cirrocumulus: 7,
        cirrostratus: 6,
        altocumulus: 10,
        altostratus: 5,
        stratocumulus: -2,
        cumulus: 2,
        stratus: -10,
        cumulonimbus: -15,
      };

      // Average type scores
      const avgTypeScore = cloudTypes.reduce((sum, type) => sum + typeScores[type], 0) / cloudTypes.length;
      
      // Bonus for cloud variety (more layering = more drama)
      const varietyBonus = cloudTypes.length > 1 ? 3 : 0;
      
      typeBonus = avgTypeScore + varietyBonus;
    }

    // Combine coverage and type
    const finalScore = Math.min(100, Math.max(0, coverageScore + layerScore + typeBonus));

    return {
      value: cloudCover,
      score: finalScore,
      weight: this.WEIGHTS.cloudStructure,
      impact: finalScore >= 75 ? 'positive' : finalScore >= 45 ? 'neutral' : 'negative',
    };
  }

  /**
   * Score atmospheric clarity (25%)
   * Combines visibility and aerosol content
   * 
   * Key insight: MODERATE particles = best (not too clean, not too polluted)
   * Small particles enhance reds/oranges via Mie scattering
   */
  private scoreAtmosphericClarity(
    visibility?: number,
    aqi?: number,
    humidity?: number,
    vaporPressureDeficit?: number,
    weatherCode?: string,
    precipitation = 0
  ): FactorScore {
    let visibilityScore: number | undefined;
    let aerosolScore: number | undefined;
    const code = this.parseWeatherCode(weatherCode);

    // VISIBILITY COMPONENT
    // Good visibility needed, but perfect clarity can be boring
    if (visibility !== undefined) {
      if (visibility >= 10000) {
        visibilityScore = 90; // Good but might be too clean
      } else if (visibility >= 5000) {
        visibilityScore = 95; // Optimal - some particles present
      } else if (visibility >= 2000) {
        visibilityScore = 70 + ((visibility - 2000) / 3000) * 25;
      } else {
        visibilityScore = Math.max(20, (visibility / 2000) * 70);
      }
    } else if (vaporPressureDeficit !== undefined || humidity !== undefined) {
      // Historical archive does not provide visibility. Use supported moisture fields
      // as a haze/clarity proxy instead of fabricating a perfect visibility value.
      if (precipitation > 0 || this.isWetWeatherCode(code) || this.isFogWeatherCode(code)) {
        visibilityScore = 35;
      } else if ((humidity ?? 0) >= 90 || (vaporPressureDeficit ?? 0) < 0.2) {
        visibilityScore = 40;
      } else if ((humidity ?? 0) >= 80 || (vaporPressureDeficit ?? 0) < 0.4) {
        visibilityScore = 55;
      } else if ((vaporPressureDeficit ?? 0) >= 0.4 && (vaporPressureDeficit ?? 0) <= 1.2) {
        visibilityScore = 78;
      } else if ((vaporPressureDeficit ?? 0) <= 2.0) {
        visibilityScore = 70;
      } else {
        visibilityScore = 60;
      }
    }

    // AEROSOL COMPONENT  
    // Moderate aerosols = color amplifier
    if (aqi !== undefined) {
      // AQI: 1=Good, 2=Fair, 3=Moderate, 4=Poor, 5=Very Poor
      switch (aqi) {
        case 1: // Too clean - less color enhancement
          aerosolScore = 75;
          break;
        case 2: // IDEAL - perfect particle balance
          aerosolScore = 100;
          break;
        case 3: // Good scattering still
          aerosolScore = 90;
          break;
        case 4: // Too much - starts dulling colors
          aerosolScore = 50;
          break;
        case 5: // Heavy pollution - muted
          aerosolScore = 20;
          break;
        default:
          aerosolScore = 75;
      }
    }

    let finalScore: number;
    if (visibilityScore !== undefined && aerosolScore !== undefined) {
      finalScore = visibilityScore * 0.4 + aerosolScore * 0.6;
    } else if (visibilityScore !== undefined) {
      finalScore = visibilityScore;
    } else if (aerosolScore !== undefined) {
      finalScore = aerosolScore;
    } else {
      // Missing clarity data should be neutral, not optimistically high.
      finalScore = 65;
    }

    const impact = finalScore >= 80 ? 'positive' : finalScore >= 55 ? 'neutral' : 'negative';

    return {
      value: aqi ?? (visibility !== undefined ? Math.round(visibility / 1000) : 0),
      score: finalScore,
      weight: this.WEIGHTS.atmosphericClarity,
      impact,
    };
  }

  private scorePressureTrend(
    pressure: number,
    previousConditions?: WeatherConditions
  ): FactorScore {
    if (!previousConditions) {
      return {
        value: 0,
        score: 65,
        weight: 0,
        impact: 'neutral',
      };
    }

    const delta = pressure - previousConditions.pressure;
    let score = 65;
    let impact: 'positive' | 'negative' | 'neutral' = 'neutral';

    if (delta >= 3) {
      score = 88;
      impact = 'positive';
    } else if (delta >= 1) {
      score = 78;
      impact = 'positive';
    } else if (delta <= -3) {
      score = 40;
      impact = 'negative';
    } else if (delta <= -1) {
      score = 55;
      impact = 'negative';
    }

    return {
      value: Math.round(delta * 10) / 10,
      score,
      weight: 0,
      impact,
    };
  }

  /**
   * Score humidity (12%)
   * Medium humidity = color blender via Mie scattering
   * Too high = haze kills contrast
   */
  private scoreHumidity(humidity: number): FactorScore {
    // Optimal: 40-70%
    let score: number;
    let impact: 'positive' | 'negative' | 'neutral';

    if (humidity < 30) {
      // Too dry - sharper but less dramatic
      score = 65;
      impact = 'neutral';
    } else if (humidity >= 30 && humidity <= 70) {
      // OPTIMAL - creates smooth gradients and color blending
      score = 85 + (50 - Math.abs(50 - humidity)) * 0.3;
      impact = 'positive';
    } else if (humidity > 70 && humidity <= 85) {
      // Getting hazy
      score = 85 - (humidity - 70);
      impact = 'neutral';
    } else {
      // Very humid - haze reduces contrast
      score = Math.max(25, 70 - humidity);
      impact = 'negative';
    }

    return {
      value: humidity,
      score,
      weight: this.WEIGHTS.humidity,
      impact,
    };
  }

  /**
   * Score weather dynamics (13%)
   * THE MAGIC TRIGGER: Post-storm clearing
   * 
   * Rain removes large particles → clean air + structured clouds = dramatic lighting
   */
  private scoreWeatherDynamics(
    weatherCode: string,
    precipitation: number,
    pressure: number,
    previousConditions?: WeatherConditions,
    recentPrecipitation = previousConditions?.precipitation ?? 0
  ): FactorScore {
    const code = this.parseWeatherCode(weatherCode);
    let score = 70;
    let impact: 'positive' | 'negative' | 'neutral' = 'neutral';

    // MOST IMPORTANT: Post-storm clearing (THE MAGIC TRIGGER)
    if (recentPrecipitation > 0 && precipitation === 0) {
      // Recently cleared after rain - BEST scenario
      // Clean air + structured clouds + dramatic layers
      score = recentPrecipitation >= 2 ? 100 : 92;
      impact = 'positive';
    }
    // Rising pressure indicates improving conditions
    else if (previousConditions && pressure > previousConditions.pressure + 2) {
      score = 85;
      impact = 'positive';
    }
    // Active precipitation during sunset
    else if (precipitation > 0 || this.isWetWeatherCode(code)) {
      score = 30;
      impact = 'negative';
    }
    // Thunderstorms (can be dramatic if clearing)
    else if (this.isThunderWeatherCode(code)) {
      score = 55; // Risky but potential
      impact = 'neutral';
    }
    // Overcast
    else if (code === 3) {
      score = 35;
      impact = 'negative';
    }
    // Clear skies
    else if (code === 0 || code === 1) {
      score = 60; // Needs clouds for drama
      impact = 'neutral';
    }
    // Partly cloudy - good baseline
    else if (code === 2) {
      score = 78;
      impact = 'positive';
    }

    return {
      value: precipitation,
      score,
      weight: this.WEIGHTS.weatherDynamics,
      impact,
    };
  }

  /**
   * Score sun geometry (10%)
   * Baseline modifier: longer atmospheric path = more scattering
   * Seasonal and latitude effects
   */
  private scoreSunGeometry(lat: number, date: Date): FactorScore {
    // Seasonal factor (month of year)
    const month = date.getMonth(); // 0-11
    
    let seasonalBonus = 0;
    // Winter months (Nov-Feb in Northern Hemisphere) often produce redder sunsets
    if (month >= 10 || month <= 1) {
      seasonalBonus = 10; // Longer atmospheric path in winter
    } else if (month >= 5 && month <= 7) {
      seasonalBonus = 5; // Summer sunsets at higher angle
    } else {
      seasonalBonus = 7; // Spring/Fall moderate
    }

    // Latitude factor
    let latitudeBonus = 0;
    const absLat = Math.abs(lat);
    if (absLat > 45) {
      // Higher latitudes = longer twilight, more dramatic
      latitudeBonus = 8;
    } else if (absLat > 30) {
      latitudeBonus = 5;
    } else {
      // Tropical latitudes - faster sunset
      latitudeBonus = 3;
    }

    // Base score with bonuses
    const baseScore = 70;
    const finalScore = Math.min(100, baseScore + seasonalBonus + latitudeBonus);

    return {
      value: Math.round(absLat),
      score: finalScore,
      weight: this.WEIGHTS.sunGeometry,
      impact: 'neutral', // Baseline modifier
    };
  }

  /**
   * Calculate confidence level based on data completeness
   */
  private calculateConfidence(
    conditions: WeatherConditions,
    previousConditions?: WeatherConditions
  ): number {
    let confidence = 0.7; // Base confidence

    // Increase confidence if we have optional data
    if (conditions.visibility !== undefined) confidence += 0.05;
    if (conditions.aqi !== undefined) confidence += 0.1;
    if (conditions.uvIndex !== undefined) confidence += 0.05;
    if (conditions.cloudTypes && conditions.cloudTypes.length > 0) confidence += 0.1;
    if (
      conditions.cloudCoverLow !== undefined ||
      conditions.cloudCoverMid !== undefined ||
      conditions.cloudCoverHigh !== undefined
    ) confidence += 0.05;
    if (previousConditions) confidence += 0.05;

    return Math.min(1.0, confidence);
  }

  private parseWeatherCode(weatherCode?: string): number {
    const parsed = Number(weatherCode);
    return Number.isFinite(parsed) ? parsed : -1;
  }

  private isFogWeatherCode(code: number): boolean {
    return code >= 45 && code <= 48;
  }

  private isWetWeatherCode(code: number): boolean {
    return (code >= 51 && code <= 67) || (code >= 80 && code <= 82);
  }

  private isThunderWeatherCode(code: number): boolean {
    return code >= 95 && code <= 99;
  }
}

export const scoringService = new ScoringService();
