import { Container, Graphics } from 'pixi.js';

/**
 * Build the spec-example scene: an ellipse (`g1`), a rectangle (`g2`),
 * and a `subContainer` translated by (75, 50) containing two lines
 * (`g3`, `g4`). Mirrors the demo in `test.pdf` so the Pixi and Skia
 * canvases can be visually compared side-by-side.
 *
 * Objects are tagged with stable `name` values so Task 11 / Task 12 can
 * dispatch events back to the correct `DisplayObject` from either canvas.
 */
export function buildInitialScene(): Container {
  const root = new Container();
  root.name = 'root';

  const g1 = new Graphics();
  g1.name = 'g1';
  g1.beginFill(0xff3030, 1).drawEllipse(90, 80, 60, 40).endFill();
  root.addChild(g1);

  const g2 = new Graphics();
  g2.name = 'g2';
  g2.beginFill(0x209a3a, 1).drawRect(180, 40, 200, 200).endFill();
  root.addChild(g2);

  const subContainer = new Container();
  subContainer.name = 'subContainer';
  subContainer.position.set(75, 50);
  root.addChild(subContainer);

  const g3 = new Graphics();
  g3.name = 'g3';
  g3.lineStyle(10, 0xffffff, 1).moveTo(0, 0).lineTo(150, 100);
  subContainer.addChild(g3);

  const g4 = new Graphics();
  g4.name = 'g4';
  g4.lineStyle(5, 0x111111, 1).moveTo(150, 0).lineTo(0, 100);
  subContainer.addChild(g4);

  return root;
}
