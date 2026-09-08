-- JamBets Phase 4: Production Football Prediction Engine Schema Extension
-- Updates confidence_category check constraint, adds dataset & model metadata tables,
-- and grants public read RLS policies for client consumption.

-- 1. Update confidence_category check constraint on football_predictions
ALTER TABLE public.football_predictions
  DROP CONSTRAINT IF EXISTS football_predictions_confidence_category_check;

ALTER TABLE public.football_predictions
  ADD CONSTRAINT football_predictions_confidence_category_check
  CHECK (confidence_category IN (
    'BANGER', 'TOP PICK', 'HIGH CONFIDENCE', 'MID CONFIDENCE', 'LOW CONFIDENCE', 'RISKY',
    'low', 'medium', 'high', 'very_high'
  ));

-- 2. Create football_datasets table for tracking versioned historical training datasets
CREATE TABLE IF NOT EXISTS public.football_datasets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_version TEXT NOT NULL UNIQUE,
    sources JSONB NOT NULL DEFAULT '[]'::jsonb,
    leagues JSONB NOT NULL DEFAULT '[]'::jsonb,
    seasons JSONB NOT NULL DEFAULT '[]'::jsonb,
    record_count INTEGER NOT NULL DEFAULT 0,
    verified_records INTEGER NOT NULL DEFAULT 0,
    rejected_records INTEGER NOT NULL DEFAULT 0,
    conflicted_records INTEGER NOT NULL DEFAULT 0,
    date_range_start TIMESTAMPTZ,
    date_range_end TIMESTAMPTZ,
    validation_status TEXT NOT NULL DEFAULT 'verified',
    missing_data_coverage JSONB DEFAULT '{}'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Create football_models table for tracking versioned production models and backtest results
CREATE TABLE IF NOT EXISTS public.football_models (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_version TEXT NOT NULL UNIQUE,
    model_type TEXT NOT NULL,
    dataset_version TEXT NOT NULL REFERENCES public.football_datasets(dataset_version) ON DELETE RESTRICT,
    parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
    home_advantage DECIMAL(4,3) DEFAULT 1.250,
    rho_dependence DECIMAL(4,3) DEFAULT -0.110,
    training_metrics JSONB DEFAULT '{}'::jsonb,
    validation_metrics JSONB DEFAULT '{}'::jsonb,
    test_metrics JSONB DEFAULT '{}'::jsonb,
    calibration_method TEXT DEFAULT 'isotonic',
    calibration_version TEXT DEFAULT 'v1.0.0',
    is_active BOOLEAN NOT NULL DEFAULT true,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Enable Row Level Security and Public Read Policies
ALTER TABLE public.football_predictions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read football_predictions" ON public.football_predictions;
CREATE POLICY "Public read football_predictions"
  ON public.football_predictions
  FOR SELECT
  TO anon, authenticated
  USING (true);

ALTER TABLE public.football_simulations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read football_simulations" ON public.football_simulations;
CREATE POLICY "Public read football_simulations"
  ON public.football_simulations
  FOR SELECT
  TO anon, authenticated
  USING (true);

ALTER TABLE public.football_datasets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read football_datasets" ON public.football_datasets;
CREATE POLICY "Public read football_datasets"
  ON public.football_datasets
  FOR SELECT
  TO anon, authenticated
  USING (true);

ALTER TABLE public.football_models ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read football_models" ON public.football_models;
CREATE POLICY "Public read football_models"
  ON public.football_models
  FOR SELECT
  TO anon, authenticated
  USING (true);

GRANT SELECT ON public.football_datasets TO anon, authenticated;
GRANT SELECT ON public.football_models TO anon, authenticated;
