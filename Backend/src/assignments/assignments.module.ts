import { Module } from '@nestjs/common';
import { AccessGuard } from '../cabinet/access.guard';
import { AssignmentsController } from './assignments.controller';
import { AssignmentsService } from './assignments.service';

@Module({
  controllers: [AssignmentsController],
  providers: [AssignmentsService, AccessGuard],
})
export class AssignmentsModule {}
