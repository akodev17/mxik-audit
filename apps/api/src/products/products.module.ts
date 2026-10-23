import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';

/** The product catalogue and MXIK intelligence (registry module `products`, Agent 4). */
@Module({ controllers: [ProductsController] })
export class ProductsModule {}
