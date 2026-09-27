import { type ArgumentsHost, Catch, type ExceptionFilter, Logger } from '@nestjs/common';
import { toProblem } from './problem';

type HttpReply = {
  status(code: number): HttpReply;
  header(name: string, value: string): HttpReply;
  send(payload: unknown): void;
};

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const body = toProblem(exception);
    if (body.status >= 500 && exception instanceof Error) {
      this.logger.error(exception.message);
    }
    const reply = host.switchToHttp().getResponse<HttpReply>();
    reply
      .status(body.status)
      .header('Content-Type', 'application/problem+json; charset=utf-8')
      .send(body);
  }
}
