export type LogLevel = "off" | "normal" | "dev";

export interface ClassifierTrace {
  engine: "JEV_CLOUD" | "LOCAL_TRANSFORMERS";
  latency_ms: number;
  target_route?: string;
  intent?: string;
  raw_scores?: Record<string, number>;
  confidence_score: number;
  confidence_level: "HIGH" | "MEDIUM" | "LOW";
  decision_reason: string;
}

export interface ExtractorTrace {
  tokens_parsed: string[];
  stopwords_removed: string[];
  time_hints: Record<string, boolean>;
  regex_matches: Array<{
    param: string;
    matched_value: string;
    matched_phrase?: string;
    rule: string;
  }>;
  transformers_status: Array<{
    param: string;
    status: "ENGAGED" | "STANDBY" | "SKIPPED";
    score?: number;
    margin?: number;
    matched_value?: string;
    reason?: string;
  }>;
  output_slots: Record<string, any>;
}

export interface ResolverTrace {
  target_route: string;
  param_specs_evaluated: string[];
  redis_operations: Array<{
    key: string;
    op: "GET" | "SET";
    status: "HIT" | "MISS";
  }>;
  http_calls: Array<{
    endpoint: string;
    param: string;
    query_token?: string;
    results_count: number;
  }>;
  token_exclusion: {
    consumed: string[];
    remaining: string[];
    skipped_calls: string[];
  };
  resolved_params: Record<string, Array<{ id: string; name: string }>>;
}

export interface DispatcherTrace {
  base_url: string;
  final_urls: string[];
  total_options: number;
  composite_confidence: number;
  confidence_level: "HIGH" | "MEDIUM" | "LOW";
}

export interface PipelineTrace {
  query: string;
  client_id: string;
  user_role: string;
  start_time: number;
  timings_ms: {
    classifier: number;
    extractor: number;
    resolver: number;
    dispatcher: number;
    total: number;
  };
  step1_classifier?: ClassifierTrace;
  step2_extractor?: ExtractorTrace;
  step3_resolver?: ResolverTrace;
  step4_dispatcher?: DispatcherTrace;
}

export function createPipelineTrace(query: string, clientId: string, userRole: string): PipelineTrace {
  return {
    query,
    client_id: clientId,
    user_role: userRole,
    start_time: performance.now(),
    timings_ms: {
      classifier: 0,
      extractor: 0,
      resolver: 0,
      dispatcher: 0,
      total: 0,
    },
  };
}
