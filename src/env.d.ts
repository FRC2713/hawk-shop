/// <reference types="astro/client" />
declare namespace App {
  interface Locals {
    identity?: import("./server/suite-identity").SuiteIdentity;
  }
}
declare module "virtual:hawk-shop/server-only";
