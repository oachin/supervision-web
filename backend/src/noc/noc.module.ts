import { Module } from '@nestjs/common';
import { NocService } from './noc.service';
import { NocController } from './noc.controller';

@Module({
  controllers: [NocController],
  providers: [NocService],
})
export class NocModule {}
