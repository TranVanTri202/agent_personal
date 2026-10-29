import { Global, Module } from '@nestjs/common';
import { StickerLibraryService } from './sticker-library.service';
import { StickerSelectorService } from './sticker-selector.service';
import { StickerService } from './sticker.service';

@Global()
@Module({
  providers: [StickerLibraryService, StickerSelectorService, StickerService],
  exports: [StickerLibraryService, StickerSelectorService, StickerService],
})
export class StickersModule {}
