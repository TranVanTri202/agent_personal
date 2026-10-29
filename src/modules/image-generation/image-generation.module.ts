import { Global, Module } from '@nestjs/common';
import { ImageCapabilityService } from './image-capability.service';
import { OpenRouterImageClient } from './openrouter-image.client';
import { ImageContextService } from './image-context.service';
import { ImageGenerationService } from './image-generation.service';

@Global()
@Module({
  providers: [
    ImageCapabilityService,
    OpenRouterImageClient,
    ImageContextService,
    ImageGenerationService,
  ],
  exports: [
    ImageCapabilityService,
    OpenRouterImageClient,
    ImageContextService,
    ImageGenerationService,
  ],
})
export class ImageGenerationModule {}
