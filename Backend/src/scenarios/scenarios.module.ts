import { Module } from '@nestjs/common';
import { ScenariosController } from './scenarios.controller';
import { ScenariosService } from './scenarios.service';
import { ScenariosAdminController } from './scenarios-admin.controller';

@Module({
  controllers: [ScenariosController, ScenariosAdminController],
  providers: [ScenariosService],
  exports: [ScenariosService],
})
export class ScenariosModule {}
