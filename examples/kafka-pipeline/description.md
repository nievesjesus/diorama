draw our kafka event pipeline as a dark isometric figure: a producer service publishes
to a topic that has three partitions, and two consumer groups read from it and flush
into a warehouse sink. show the topic as three thin cylinders standing in a row on a
rack-like base, keep the producer on the left and the sink set back on the right, and
mirror the two consumers below the topic.

add a schema registry the producer registers events with, a cluster controller that
keeps the leaders elected, a committed-offsets pad beside each consumer group, and a
dead-letter queue in brick red where poison events get parked.

use one accent color for the partitions, keep the packet flows calm and left to right,
label everything in english, and show a readout: partitions 3, consumer lag, retention 7 days.
