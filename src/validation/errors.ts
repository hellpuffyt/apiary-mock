export interface ValidationIssue {
  location: "path" | "query" | "header" | "body" | "content-type";
  path: string;
  message: string;
}

export class RequestValidationError extends Error {
  readonly status: number;
  readonly issues: ValidationIssue[];

  constructor(status: number, issues: ValidationIssue[]) {
    super(`Request validation failed with ${issues.length} issue(s)`);
    this.name = "RequestValidationError";
    this.status = status;
    this.issues = issues;
  }

  toBody(): Record<string, unknown> {
    return {
      error: this.status === 404 ? "Not Found" : "Bad Request",
      status: this.status,
      message: "Request does not satisfy the API specification for this operation.",
      issues: this.issues,
    };
  }
}
