Hey everyone! Welcome to Cyber Protocol 3D. This is a browser-based typing survival arena I built from scratch using Three.js and vanilla JavaScript.

The concept is a mix of a twin-stick shooter and a typing tutor. You are dropped into a cyberpunk arena and have to survive against waves of enemies by typing the letters hovering above their heads to shoot them. The catch? You can't just stand still. You have to physically run around the grid and jump over laser blasts and ground shockwaves while you type.
How to Play

    Move: Arrow Keys

    Jump: Spacebar (Use this to dodge incoming ground lasers and boss shockwaves)

    Shoot: Type the cyan letters above the enemies' heads.

If you type perfectly without messing up, you build a combo that speeds up your character. If you miss a key, your combo breaks and the screen shakes.
What's Inside

    3-Phase Escalation: You start fighting basic swarm grunts. At 50 kills, Elite shooters spawn that fire lasers you have to jump over. At 100 kills, the minions stop and a massive Boss Overlord spawns with a custom health bar and heavy shockwave attacks.

    Dynamic Arsenal: Your weapon automatically upgrades and mounts to your character's hand based on the current wave.

    Environmental Hazards: Watch out for EMP slime bubbles on the floor that cut your movement speed in half.

How to Run It Locally

Because the game loads binary 3D models (.glb files), you can't just double-click the index.html file to play it (browsers will block the 3D files for security reasons).

To run it on your own machine:

    Open the project folder in VS Code.

    Install the Live Server extension.

    Right-click index.html and select Open with Live Server.

For the Devs (Architecture Notes)

I wanted to keep this project as lightweight as possible, so the entire engine, game loop, shaders, and UI are contained in a single index.html file.

One of the coolest technical features is the fallback system. The game expects to find custom .glb models in the assets/models/ folder. But if a file is missing, the game does not crash. I built a procedural generation script that automatically generates rigged, animated geometric stand-ins using Three.js so the game stays fully playable even if the asset folder is totally empty.
